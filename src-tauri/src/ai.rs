// OpenAI 兼容 API 的流式(SSE)调用引擎
// SSE 解析为纯函数,可单元测试;网络层为 reqwest(rustls)

use serde_json::Value;

/// 增量 SSE 解析器:喂入字节块,产出完整的 content 增量
#[derive(Default)]
pub struct SseParser {
    buf: String,
    pub done: bool,
}

impl SseParser {
    pub fn feed(&mut self, s: &str) -> Vec<String> {
        self.buf.push_str(s);
        let mut out = Vec::new();
        // SSE 事件以空行分隔;逐行扫描足够可靠
        while let Some(pos) = self.buf.find('\n') {
            let line = self.buf[..pos].trim_end_matches('\r').to_string();
            self.buf.drain(..=pos);
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data == "[DONE]" {
                    self.done = true;
                    break;
                }
                if let Some(delta) = extract_delta(data) {
                    if !delta.is_empty() {
                        out.push(delta);
                    }
                }
            }
            // 空行与注释行(: keep-alive)忽略
        }
        out
    }

    pub fn finish(&mut self) -> Vec<String> {
        // 流意外结束时处理缓冲中的残余事件
        let rest = std::mem::take(&mut self.buf);
        self.feed(&rest)
    }
}

/// 从一条 data JSON 中取 choices[0].delta.content(兼容缺字段/多 choice 供体)
fn extract_delta(data: &str) -> Option<String> {
    let v: Value = serde_json::from_str(data).ok()?;
    let content = v
        .get("choices")?
        .get(0)?
        .get("delta")?
        .get("content")?
        .as_str()?;
    Some(content.to_string())
}

/// 把 HTTP 错误转换为面向用户的中文提示(不包含密钥与文稿内容)
pub fn describe_http_error(status: u16, body: &str) -> String {
    // 尝试取 OpenAI 风格错误体中的 message
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("message"))
                .or_else(|| v.get("message"))
                .and_then(|m| m.as_str().map(|s| s.to_string()))
        })
        .unwrap_or_default();
    let head = match status {
        401 | 403 => "API Key 无效或无权限".to_string(),
        404 => "接口不存在,请检查 Base URL(通常应以 /v1 结尾)".to_string(),
        429 => "请求过于频繁或额度不足".to_string(),
        s if s >= 500 => "模型服务端错误".to_string(),
        s => format!("HTTP {}", s),
    };
    if detail.is_empty() {
        head
    } else {
        format!("{}:{}", head, truncate_detail(&detail))
    }
}

fn truncate_detail(s: &str) -> String {
    let t: String = s.chars().take(160).collect();
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_parses_deltas_and_done() {
        let mut p = SseParser::default();
        let mut got = p.feed("data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n");
        assert_eq!(got, vec!["Hel", "lo"]);
        assert!(!p.done);
        got = p.feed("data: [DONE]\n\n");
        assert!(got.is_empty());
        assert!(p.done);
    }

    #[test]
    fn sse_handles_split_chunks() {
        let mut p = SseParser::default();
        assert!(p.feed("data: {\"choices\":[{\"delta\":{\"con").is_empty());
        let got = p.feed("tent\":\"x\"}}]}\n\n");
        assert_eq!(got, vec!["x"]);
    }

    #[test]
    fn sse_ignores_keepalive() {
        let mut p = SseParser::default();
        assert!(p.feed(": ping\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n").join("") == "a");
    }

    #[test]
    fn http_error_messages() {
        assert!(describe_http_error(401, "{\"error\":{\"message\":\"bad key\"}}").starts_with("API Key"));
        assert!(describe_http_error(404, "").starts_with("接口不存在"));
        assert!(describe_http_error(500, "{}").starts_with("模型服务端错误"));
    }
}
