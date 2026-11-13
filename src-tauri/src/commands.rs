// Tauri 命令层:文稿 IO、配置、凭据、AI 流式与连接测试
// 密钥只经系统凭据管理器存取,绝不写入文件或日志

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::ai::{describe_http_error, SseParser};
use crate::doc_io::{backup_before_overwrite, write_text_atomic};

// ---------- 与前端共享的数据结构(serde camelCase) ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    pub id: String,
    pub zh: String,
    pub en: String,
    pub en_source_zh: Option<String>,
    pub en_edited: bool,
    pub en_pending: Option<String>,
    pub scene: String,
    pub error: Option<String>,
}

fn default_paper_profile() -> String {
    "nature-omics".to_string()
}

fn default_translate_quality() -> String {
    "high".to_string()
}

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BilingualDoc {
    pub format_version: u32,
    pub doc_id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub profile: Option<String>,
    pub paragraphs: Vec<Paragraph>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub model: String,
    pub temperature: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentDoc {
    pub path: String,
    pub title: String,
    pub opened_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub version: u32,
    pub providers: Vec<ProviderConfig>,
    pub active_provider_id: Option<String>,
    #[serde(default)]
    pub polish_provider_id: Option<String>,
    pub theme: String,
    pub zh_font_size: f64,
    pub en_font_size: f64,
    pub split_ratio: f64,
    pub auto_translate: bool,
    pub auto_delay_ms: u32,
    pub default_scene: String,
    #[serde(default = "default_paper_profile")]
    pub paper_profile: String,
    #[serde(default = "default_translate_quality")]
    pub translate_quality: String,
    #[serde(default = "default_true")]
    pub show_author_slots: bool,
    pub glossary_text: String,
    pub custom_prompt: String,
    pub recent_docs: Vec<RecentDoc>,
    pub last_opened_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AiProvider {
    #[serde(rename = "providerId")]
    pub provider_id: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    pub model: String,
    #[serde(default)]
    pub temperature: f64,
}

// ---------- 应用状态 ----------

pub struct AppState {
    pub config_path: PathBuf,
    pub backups_dir: PathBuf,
    pub close_pending: AtomicBool,
    pub close_aborted: AtomicBool,
}

pub struct AiState {
    pub cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

// ---------- 文稿命令 ----------

#[tauri::command]
pub fn load_document(path: String) -> Result<BilingualDoc, String> {
    let raw = std::fs::read_to_string(&path).map_err(|e| format!("读取文稿失败:{}", e))?;
    let raw = raw.trim_start_matches('\u{feff}');
    let doc: BilingualDoc = serde_json::from_str(raw).map_err(|e| format!("文稿格式无法解析:{}", e))?;
    if doc.paragraphs.is_empty() {
        return Err("文稿中没有段落".to_string());
    }
    Ok(doc)
}

#[tauri::command]
pub fn save_document(
    app: AppHandle,
    path: String,
    doc: BilingualDoc,
) -> Result<(), String> {
    let state: State<AppState> = app.state();
    // 先备份旧内容(每文稿保留 20 份),再原子写入
    let doc_dir = state.backups_dir.join(sanitize_dir_name(&doc.doc_id));
    backup_before_overwrite(Path::new(&path), &doc_dir, 20)?;
    let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    write_text_atomic(Path::new(&path), &json, false)
}

#[tauri::command]
pub fn write_text_file(path: String, content: String, with_bom: bool) -> Result<(), String> {
    write_text_atomic(Path::new(&path), &content, with_bom)
}

// ---------- 配置命令 ----------

#[tauri::command]
pub fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    let state: State<AppState> = app.state();
    let raw = std::fs::read_to_string(&state.config_path)
        .map_err(|_| "config not initialized".to_string())?;
    serde_json::from_str(raw.trim_start_matches('\u{feff}')).map_err(|e| format!("配置解析失败:{}", e))
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let state: State<AppState> = app.state();
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    write_text_atomic(&state.config_path, &json, false)
}

// ---------- 密钥命令(Windows 凭据管理器) ----------

const KEYRING_SERVICE: &str = "AcademicBilingualWriter";

fn entry(provider_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, provider_id).map_err(|e| format!("凭据服务不可用:{}", e))
}

#[tauri::command]
pub fn set_api_key(provider_id: String, api_key: String) -> Result<(), String> {
    let e = entry(&provider_id)?;
    e.set_password(api_key.trim())
        .map_err(|err| format!("保存密钥失败:{:?}", err))
}

#[tauri::command]
pub fn has_api_key(provider_id: String) -> Result<bool, String> {
    match entry(&provider_id)?.get_password() {
        Ok(p) => Ok(!p.is_empty()),
        Err(keyring::Error::NoEntry) => Ok(false),
        Err(e) => Err(format!("读取密钥状态失败:{:?}", e)),
    }
}

#[tauri::command]
pub fn delete_api_key(provider_id: String) -> Result<(), String> {
    match entry(&provider_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("删除密钥失败:{:?}", e)),
    }
}

fn get_api_key(provider_id: &str) -> Result<String, String> {
    match entry(provider_id)?.get_password() {
        Ok(p) if !p.is_empty() => Ok(p),
        Ok(_) | Err(keyring::Error::NoEntry) => {
            Err("尚未配置该服务的 API Key,请在设置中填写".to_string())
        }
        Err(e) => Err(format!("读取密钥失败:{:?}", e)),
    }
}

// ---------- AI 命令 ----------

#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    request_id: String,
    provider: AiProvider,
    messages: Vec<AiMessage>,
) -> Result<(), String> {
    let api_key = get_api_key(&provider.provider_id)?;
    let ai: State<AiState> = app.state();
    let flag = Arc::new(AtomicBool::new(false));
    ai.cancel_flags
        .lock()
        .unwrap()
        .insert(request_id.clone(), flag.clone());

    let result = run_stream(&app, &request_id, &provider, &messages, &api_key, flag).await;

    // 清理注册表并保证终态事件(错误路径在此发 done 语义之外,由前端统一处理)
    ai.cancel_flags.lock().unwrap().remove(&request_id);
    result
}

async fn run_stream(
    app: &AppHandle,
    request_id: &str,
    provider: &AiProvider,
    messages: &[AiMessage],
    api_key: &str,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": provider.model,
        "messages": messages,
        "temperature": provider.temperature,
        "stream": true,
    });

    // 显式不读取系统代理环境变量,避免失效代理拖垮全部请求(见 README 已知限制)
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| format!("初始化网络客户端失败:{}", e))?;

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .header("Accept", "text/event-stream")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                "无法连接到模型服务,请检查 Base URL 与网络".to_string()
            } else {
                format!("网络请求失败:{}", e)
            }
        })?;

    let status = resp.status();
    if !status.is_success() {
        let s = status.as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(describe_http_error(s, &text));
    }

    let mut stream = resp.bytes_stream();
    let mut parser = SseParser::default();

    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = app.emit("ai-done", serde_json::json!({"requestId": request_id, "cancelled": true}));
            return Ok(());
        }
        let bytes = chunk.map_err(|e| format!("读取响应流失败:{}", e))?;
        let text = String::from_utf8_lossy(&bytes).to_string();
        for delta in parser.feed(&text) {
            let _ = app.emit("ai-chunk", serde_json::json!({"requestId": request_id, "delta": delta}));
        }
        if parser.done {
            break;
        }
    }
    // 处理残余缓冲并结束
    for delta in parser.finish() {
        let _ = app.emit("ai-chunk", serde_json::json!({"requestId": request_id, "delta": delta}));
    }
    let _ = app.emit("ai-done", serde_json::json!({"requestId": request_id, "cancelled": false}));
    Ok(())
}

#[tauri::command]
pub fn cancel_ai(app: AppHandle, request_id: String) -> Result<(), String> {
    let ai: State<AiState> = app.state();
    if let Some(flag) = ai.cancel_flags.lock().unwrap().get(&request_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

#[tauri::command]
pub async fn test_connection(provider: AiProvider) -> Result<String, String> {
    let api_key = get_api_key(&provider.provider_id)?;
    let url = format!("{}/chat/completions", provider.base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": provider.model,
        "messages": [{"role": "user", "content": "Reply with the single word: ok"}],
        "max_tokens": 8,
        "temperature": 0,
    });
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(45))
        .no_proxy()
        .build()
        .map_err(|e| format!("初始化网络客户端失败:{}", e))?;
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            if e.is_connect() || e.is_timeout() {
                "无法连接到模型服务,请检查 Base URL 与网络".to_string()
            } else {
                format!("网络请求失败:{}", e)
            }
        })?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(describe_http_error(status.as_u16(), &text));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| "响应不是有效 JSON".to_string())?;
    let reply = v
        .get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .unwrap_or("(无内容)")
        .trim()
        .to_string();
    Ok(reply)
}

// ---------- 原生文件对话框(rfd 直连,独立线程阻塞调用) ----------
// tauri-plugin-dialog 在本机出现 save 对话框挂起问题,改用 rfd 阻塞 API 在独立线程执行:
// 不占用主事件循环线程,COM 初始化由 rfd 内部处理,结果直接返回。

/// 打开文稿对话框
#[tauri::command]
pub fn pick_open_path() -> Result<Option<String>, String> {
    let t = std::thread::spawn(|| {
        rfd::FileDialog::new()
            .set_title("打开双语文稿")
            .add_filter("双语文稿", &["abw.json", "json"])
            .pick_file()
    });
    Ok(t.join()
        .map_err(|_| "对话框线程异常".to_string())?
        .map(|p| p.to_string_lossy().into_owned()))
}

/// 保存/导出对话框;返回用户选择的完整路径(取消为 null)
#[tauri::command]
pub fn pick_save_path(default_name: String, filter_ext: String) -> Result<Option<String>, String> {
    let ext = filter_ext.trim_start_matches('.').to_string();
    let t = std::thread::spawn(move || {
        rfd::FileDialog::new()
            .set_title("保存文稿")
            .set_file_name(&default_name)
            .add_filter("文稿 / 文本", &[&ext, "json", "txt"])
            .save_file()
    });
    Ok(t.join()
        .map_err(|_| "对话框线程异常".to_string())?
        .map(|p| p.to_string_lossy().into_owned()))
}

// ---------- 关闭协议 ----------

/// 前端保存完成后确认退出
#[tauri::command]
pub fn confirm_close(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.destroy();
    }
    Ok(())
}

/// 前端取消退出(例如保存对话框被用户关闭)
#[tauri::command]
pub fn cancel_close(app: AppHandle) -> Result<(), String> {
    let state: State<AppState> = app.state();
    state.close_pending.store(false, Ordering::SeqCst);
    state.close_aborted.store(true, Ordering::SeqCst);
    Ok(())
}

// ---------- 工具 ----------

fn sanitize_dir_name(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_config_and_doc_deserialize_with_defaults() {
        let old_cfg = r#"{
            "version": 1,
            "providers": [],
            "activeProviderId": null,
            "theme": "light",
            "zhFontSize": 16,
            "enFontSize": 15,
            "splitRatio": 0.5,
            "autoTranslate": false,
            "autoDelayMs": 2000,
            "defaultScene": "results",
            "glossaryText": "",
            "customPrompt": "",
            "recentDocs": [],
            "lastOpenedPath": null
        }"#;
        let cfg: AppConfig = serde_json::from_str(old_cfg).expect("旧版 AppConfig 应兼容解析");
        assert_eq!(cfg.paper_profile, "nature-omics");
        assert_eq!(cfg.translate_quality, "high");
        assert_eq!(cfg.polish_provider_id, None);
        assert!(cfg.show_author_slots);

        let old_doc = r#"{
            "formatVersion": 1,
            "docId": "d1",
            "title": "Demo",
            "createdAt": "2026-01-01T00:00:00Z",
            "updatedAt": "2026-01-01T00:00:00Z",
            "paragraphs": [{
                "id": "p1",
                "zh": "测试",
                "en": "Test",
                "enSourceZh": "测试",
                "enEdited": false,
                "enPending": null,
                "scene": "conclusion",
                "error": null
            }]
        }"#;
        let doc: BilingualDoc = serde_json::from_str(old_doc).expect("旧版 BilingualDoc 应兼容解析");
        assert_eq!(doc.profile, None);
        assert_eq!(doc.paragraphs[0].scene, "conclusion");
    }
}
