// 应用入口:注册命令与插件,处理「保存后退出」的窗口关闭协议

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;
mod doc_io;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};

use commands::{AiState, AppState};

fn app_dirs(app: &AppHandle) -> (PathBuf, PathBuf) {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from(".").join("abw-data"));
    (base.join("config.json"), base.join("backups"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let (config_path, backups_dir) = app_dirs(&handle);
            std::fs::create_dir_all(&backups_dir).ok();
            app.manage(AppState {
                config_path,
                backups_dir,
                close_pending: AtomicBool::new(false),
                close_aborted: AtomicBool::new(false),
            });
            app.manage(AiState {
                cancel_flags: Mutex::new(std::collections::HashMap::new()),
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if !matches!(event, WindowEvent::CloseRequested { .. }) {
                return;
            }
            let app = window.app_handle().clone();
            let state = app.state::<AppState>();
            if state.close_pending.load(Ordering::SeqCst) {
                // confirm_close 走 destroy(),不会再次触发本事件;此分支仅为兜底
                return;
            }
            // 首次关闭请求:拦截,通知前端先保存;8 秒未确认则强制退出(防卡死)
            state.close_pending.store(true, Ordering::SeqCst);
            state.close_aborted.store(false, Ordering::SeqCst);
            let _ = app.emit("app-close-requested", ());
            std::thread::spawn(move || {
                for _ in 0..16 {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let st = app.state::<AppState>();
                    if st.close_aborted.load(Ordering::SeqCst) {
                        return; // 用户取消退出(如保存对话框被关闭)
                    }
                    if !st.close_pending.load(Ordering::SeqCst) {
                        return; // 已确认退出
                    }
                }
                // 超时:保存流程卡死,强制退出避免应用无法关闭
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.destroy();
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_document,
            commands::save_document,
            commands::write_text_file,
            commands::get_config,
            commands::save_config,
            commands::set_api_key,
            commands::has_api_key,
            commands::delete_api_key,
            commands::ai_chat_stream,
            commands::cancel_ai,
            commands::test_connection,
            commands::confirm_close,
            commands::cancel_close,
            commands::pick_open_path,
            commands::pick_save_path,
        ])
        .run(tauri::generate_context!())
        .expect("应用启动失败");
}
