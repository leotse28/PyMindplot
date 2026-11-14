//! 文件操作：导图加载/保存、附件内嵌与提取、图片读取、PNG 导出。
//! 行为逐条对齐原 app/main.py 的对应函数（含错误文案）。

use crate::mm::{serialize_mm, MmNode};
use crate::xmind::parse_xmind_bytes;
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_json::json;
use std::path::{Path, PathBuf};

/// 对齐 normalize_map_path：非 .mm/.xml 后缀追加 .mm
pub fn normalize_map_path(path: &str) -> String {
    let p = path.trim();
    let lower = p.to_lowercase();
    if lower.ends_with(".mm") || lower.ends_with(".xml") {
        p.to_string()
    } else {
        format!("{}.mm", p)
    }
}

/// 对齐 sidecar_dir：<导图>.assets 文件夹
pub fn sidecar_dir(map_path: &str) -> PathBuf {
    Path::new(map_path).with_extension("assets")
}

/// 对齐 Path.resolve() 的常用行为：绝对化 + 规范化分隔符（不做符号链接解析）
pub fn resolve_path(p: &Path) -> String {
    let abs = std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf());
    abs.to_string_lossy().replace('/', "\\")
}

fn file_name_of(p: &str) -> String {
    Path::new(p)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// 附件条目：桥接层可能传对象或字符串（字符串视为 rel）
fn entry_from(v: &serde_json::Value) -> Option<(String, String, String)> {
    // (name, rel, data)
    match v {
        serde_json::Value::String(s) => Some((String::new(), s.clone(), String::new())),
        serde_json::Value::Object(o) => {
            let name = o.get("name").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let rel = o.get("rel").and_then(|x| x.as_str()).unwrap_or("").to_string();
            let data = o.get("data").and_then(|x| x.as_str()).unwrap_or("").to_string();
            Some((name, rel, data))
        }
        _ => None,
    }
}

/// 附件字节：优先内嵌 data，其次旧版 .assets rel 引用
fn attachment_bytes(map_path: &str, rel: &str, data: &str) -> Result<Vec<u8>, String> {
    if !data.is_empty() {
        return B64
            .decode(data.as_bytes())
            .map_err(|e| format!("{}", e));
    }
    if !rel.is_empty() {
        let p = sidecar_dir(map_path).join(file_name_of(rel));
        if !p.exists() {
            return Err("附件文件不存在（.assets 文件夹可能被移动或删除）".into());
        }
        return std::fs::read(&p).map_err(|e| format!("{}", e));
    }
    Err("附件数据缺失".into())
}

// ── 导图加载 / 保存 ──────────────────────────────────────────

pub struct MapDoc {
    pub path: String,
    pub name: String,
    pub format: String,
    pub root: MmNode,
    pub layout: String,
    pub theme: String,
}

impl std::fmt::Debug for MapDoc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MapDoc")
            .field("path", &self.path)
            .field("name", &self.name)
            .field("format", &self.format)
            .field("layout", &self.layout)
            .field("theme", &self.theme)
            .finish()
    }
}

/// 对齐 load_map_file
pub fn load_map_file(path: &str) -> Result<MapDoc, String> {
    let p = Path::new(path);
    let data = std::fs::read(p).map_err(|e| format!("{}", e))?;
    let suffix = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let (root, layout, theme, fmt) = if suffix == "xmind" {
        let (r, l, t) = parse_xmind_bytes(&data)?;
        (r, l, t, "xmind".to_string())
    } else {
        let parsed = crate::mm::parse_map_bytes(&data)?;
        (parsed.root, parsed.layout, parsed.theme, suffix)
    };
    Ok(MapDoc {
        path: resolve_path(p),
        name: file_name_of(path),
        format: fmt,
        root,
        layout,
        theme,
    })
}

/// 对齐 save_map_file：payload 为 {root, layout, theme} 或根节点对象
pub fn save_map_file(path: &str, payload: &serde_json::Value) -> serde_json::Value {
    let raw = Path::new(path);
    let suffix = raw
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if suffix == "xmind" {
        return json!({
            "ok": false,
            "error": "不支持保存为 .xmind 格式，请另存为 .mm 或 .xml",
            "path": path,
        });
    }
    let target = normalize_map_path(path);
    let root: MmNode;
    let mut layout = String::new();
    let mut theme = String::new();
    match payload {
        serde_json::Value::Object(o) => {
            if let Some(r) = o.get("root") {
                root = match serde_json::from_value::<MmNode>(r.clone()) {
                    Ok(n) => n,
                    Err(e) => {
                        return json!({"ok": false, "error": format!("{}", e), "path": target});
                    }
                };
                layout = o.get("layout").and_then(|x| x.as_str()).unwrap_or("").to_string();
                theme = o.get("theme").and_then(|x| x.as_str()).unwrap_or("").to_string();
            } else {
                root = match serde_json::from_value::<MmNode>(payload.clone()) {
                    Ok(n) => n,
                    Err(e) => {
                        return json!({"ok": false, "error": format!("{}", e), "path": target});
                    }
                };
            }
        }
        _ => {
            return json!({"ok": false, "error": "缺少 root 节点", "path": target});
        }
    }
    let data = serialize_mm(&root, &layout, &theme);
    let tmp = format!("{}.tmp", target);
    match std::fs::write(&tmp, &data).and_then(|_| std::fs::rename(&tmp, &target)) {
        Ok(_) => json!({"ok": true, "path": target, "bytes": data.len()}),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            json!({"ok": false, "error": format!("{}", e), "path": path})
        }
    }
}

// ── 附件 ─────────────────────────────────────────────────────

/// 对齐 add_attachment_file：读取源文件并内嵌
pub fn add_attachment_file(map_path: &str, src_file: &str) -> serde_json::Value {
    if !Path::new(map_path).exists() {
        return json!({"ok": false, "error": "请先保存导图后再插入附件"});
    }
    let src = Path::new(src_file);
    if !src.is_file() {
        return json!({"ok": false, "error": "源文件不存在"});
    }
    match std::fs::read(src) {
        Ok(raw) => json!({
            "ok": true,
            "name": file_name_of(src_file),
            "data": B64.encode(raw),
        }),
        Err(e) => json!({"ok": false, "error": format!("{}", e)}),
    }
}

/// 对齐 add_attachment_data_file：剪贴板文件数据插入
pub fn add_attachment_data_file(map_path: &str, name: &str, data_b64: &str) -> serde_json::Value {
    if !Path::new(map_path).exists() {
        return json!({"ok": false, "error": "请先保存导图后再插入附件"});
    }
    let safe = file_name_of(name);
    let safe = if safe.is_empty() { "附件".to_string() } else { safe };
    let raw = if data_b64.is_empty() {
        Vec::new()
    } else {
        match B64.decode(data_b64.as_bytes()) {
            Ok(r) => r,
            Err(e) => return json!({"ok": false, "error": format!("{}", e)}),
        }
    };
    if raw.is_empty() {
        return json!({"ok": false, "error": "文件内容为空"});
    }
    json!({"ok": true, "name": safe, "data": data_b64})
}

/// 对齐 save_attachment_file：附件另存为（字节一致；目标已存在则拒绝）
pub fn save_attachment_file(map_path: &str, entry: &serde_json::Value, dest: &str) -> serde_json::Value {
    let Some((_, rel, data)) = entry_from(entry) else {
        return json!({"ok": false, "error": "无效的附件数据"});
    };
    if data.is_empty() && rel.is_empty() {
        return json!({"ok": false, "error": "附件数据缺失"});
    }
    let raw = match attachment_bytes(map_path, &rel, &data) {
        Ok(r) => r,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let destp = Path::new(dest);
    if file_name_of(dest).is_empty() {
        return json!({"ok": false, "error": "无效的保存路径"});
    }
    if destp.exists() {
        return json!({"ok": false, "error": "目标文件已存在"});
    }
    if let Some(parent) = destp.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            return json!({"ok": false, "error": format!("{}", e)});
        }
    }
    match std::fs::write(destp, raw) {
        Ok(_) => json!({"ok": true, "path": resolve_path(destp)}),
        Err(e) => json!({"ok": false, "error": format!("{}", e)}),
    }
}

/// 附件提取目标目录（对齐 tempfile.gettempdir() / "PyMindplot_附件"）
fn attach_out_dir() -> PathBuf {
    std::env::temp_dir().join("PyMindplot_附件")
}

/// 对齐 extract_attachment_file：解压到临时目录并去重命名
pub fn extract_attachment_file(map_path: &str, entry: &serde_json::Value) -> serde_json::Value {
    let Some((name, rel, data)) = entry_from(entry) else {
        return json!({"ok": false, "error": "无效的附件数据"});
    };
    let base_name = {
        let n = file_name_of(if name.is_empty() { "附件" } else { &name });
        if n.is_empty() { "附件".to_string() } else { n }
    };
    let raw = match attachment_bytes(map_path, &rel, &data) {
        Ok(r) => r,
        Err(e) => return json!({"ok": false, "error": e}),
    };
    let out_dir = attach_out_dir();
    if let Err(e) = std::fs::create_dir_all(&out_dir) {
        return json!({"ok": false, "error": format!("{}", e)});
    }
    let mut target = out_dir.join(&base_name);
    let stem = target
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let ext = target
        .extension()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default();
    let mut i = 1;
    while target.exists() {
        let fname = if ext.is_empty() {
            format!("{}({})", stem, i)
        } else {
            format!("{}({}).{}", stem, i, ext)
        };
        target = out_dir.join(fname);
        i += 1;
    }
    match std::fs::write(&target, raw) {
        Ok(_) => json!({
            "ok": true,
            "path": resolve_path(&target),
            "name": target.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
        }),
        Err(e) => json!({"ok": false, "error": format!("{}", e)}),
    }
}

/// 对齐 open_attachment_file：提取后用系统关联程序打开
pub fn open_attachment_file(map_path: &str, entry: &serde_json::Value) -> serde_json::Value {
    let res = extract_attachment_file(map_path, entry);
    if !res.get("ok").and_then(|x| x.as_bool()).unwrap_or(false) {
        return res;
    }
    let path = res.get("path").and_then(|x| x.as_str()).unwrap_or("");
    match open::that(path) {
        Ok(_) => json!({"ok": true, "path": path}),
        Err(e) => json!({"ok": false, "error": format!("{}", e)}),
    }
}

// ── 图片 ─────────────────────────────────────────────────────

/// 对齐 add_image_file：剪贴板图片内嵌
pub fn add_image_file(map_path: &str, data_b64: &str, ext: &str) -> serde_json::Value {
    if !Path::new(map_path).exists() {
        return json!({"ok": false, "error": "请先保存导图后再粘贴图片"});
    }
    let raw = match B64.decode(data_b64.as_bytes()) {
        Ok(r) => r,
        Err(e) => return json!({"ok": false, "error": format!("{}", e)}),
    };
    if raw.is_empty() {
        return json!({"ok": false, "error": "图片数据为空"});
    }
    let mut e: String = ext
        .to_lowercase()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
        .collect();
    if e.is_empty() {
        e = "png".into();
    }
    json!({"ok": true, "name": format!("粘贴图片.{}", e), "data": data_b64})
}

/// 对齐 read_image_data：读取旧版 .assets 图片（防路径穿越）
pub fn read_image_data(map_path: &str, rel: &str) -> serde_json::Value {
    let safe = file_name_of(rel);
    if safe.is_empty() {
        return json!({"ok": false, "error": "无效的图片路径"});
    }
    let p = sidecar_dir(map_path).join(safe);
    if !p.exists() {
        return json!({"ok": false, "error": "图片文件不存在"});
    }
    let ext = p
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    let mime = match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    };
    match std::fs::read(&p) {
        Ok(raw) => json!({"ok": true, "data": B64.encode(raw), "mime": mime}),
        Err(e) => json!({"ok": false, "error": format!("{}", e)}),
    }
}

/// 对齐 save_png_file：校验 PNG 魔数后写为同名 .png
pub fn save_png_file(map_path: &str, data_b64: &str) -> serde_json::Value {
    if !Path::new(map_path).exists() {
        return json!({"ok": false, "error": "请先保存导图后再导出 PNG"});
    }
    let raw = match B64.decode(data_b64.trim().as_bytes()) {
        Ok(r) => r,
        Err(e) => return json!({"ok": false, "error": format!("{}", e)}),
    };
    if raw.is_empty() {
        return json!({"ok": false, "error": "PNG 数据为空"});
    }
    if !raw.starts_with(b"\x89PNG\r\n\x1a\n") {
        return json!({"ok": false, "error": "数据不是有效的 PNG 图片"});
    }
    let target = Path::new(map_path).with_extension("png");
    match std::fs::write(&target, raw) {
        Ok(_) => json!({
            "ok": true,
            "name": target.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default(),
            "path": resolve_path(&target),
        }),
        Err(e) => json!({"ok": false, "error": format!("{}", e)}),
    }
}

// 供测试使用的重导出
pub use crate::mm::{decode_attachments, parse_map_bytes};
pub use crate::xml::parse_xml;
