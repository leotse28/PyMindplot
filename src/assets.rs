//! 前端资产：编译期内嵌 web/（与原项目 app/web 逐字节一致），经 wry 自定义协议
//! 以虚拟主机方式提供给 WebView2（file:// 页面的 postMessage 会被 WebView2 静默
//! 丢弃，故与 Tauri 同款改走 http 虚拟主机；资产不落盘、不依赖外部文件）。

use std::borrow::Cow;

/// 自定义协议名；页面 URL 形如 app://localhost/index.html
pub const PROTOCOL: &str = "app";
pub const INDEX_URL: &str = "app://localhost/index.html";

pub const INDEX_HTML: &str = include_str!("../web/index.html");
pub const APP_CSS: &str = include_str!("../web/css/app.css");
pub const MODEL_JS: &str = include_str!("../web/js/model.js");
pub const LAYOUT_JS: &str = include_str!("../web/js/layout.js");
pub const MINIMATH_JS: &str = include_str!("../web/js/minimath.js");
pub const RENDER_JS: &str = include_str!("../web/js/render.js");
pub const APP_JS: &str = include_str!("../web/js/app.js");

/// (路径, 内容, MIME)
const FILES: [(&str, &[u8], &str); 7] = [
    ("/index.html", INDEX_HTML.as_bytes(), "text/html; charset=utf-8"),
    ("/css/app.css", APP_CSS.as_bytes(), "text/css; charset=utf-8"),
    ("/js/model.js", MODEL_JS.as_bytes(), "application/javascript; charset=utf-8"),
    ("/js/layout.js", LAYOUT_JS.as_bytes(), "application/javascript; charset=utf-8"),
    ("/js/minimath.js", MINIMATH_JS.as_bytes(), "application/javascript; charset=utf-8"),
    ("/js/render.js", RENDER_JS.as_bytes(), "application/javascript; charset=utf-8"),
    ("/js/app.js", APP_JS.as_bytes(), "application/javascript; charset=utf-8"),
];

/// 自定义协议处理器：按路径返回内嵌资产（404 兜底）。
pub fn serve(uri_path: &str) -> http::Response<Cow<'static, [u8]>> {
    let path = uri_path.split(['?', '#']).next().unwrap_or("");
    let path = if path == "/" || path.is_empty() {
        "/index.html"
    } else {
        path
    };
    for (p, content, mime) in FILES {
        if p == path {
            return http::Response::builder()
                .status(200)
                .header("Content-Type", mime)
                .header("Access-Control-Allow-Origin", "*")
                .body(Cow::Borrowed(content))
                .unwrap();
        }
    }
    http::Response::builder()
        .status(404)
        .header("Content-Type", "text/plain; charset=utf-8")
        .body(Cow::Borrowed(&b"not found"[..]))
        .unwrap()
}
