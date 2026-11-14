//! 应用配置（app.config.json）：与原 main.py 的 load_config/save_config 对齐。
//! 用原始 JSON Map 承载，保留未知键（对齐 dict.update 的合并语义）。

use crate::mm::CONFIG_FILENAME;
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};

pub fn config_dir() -> PathBuf {
    std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_path() -> PathBuf {
    config_dir().join(CONFIG_FILENAME)
}

pub fn default_config() -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("lastFile".into(), json!(""));
    m.insert("width".into(), json!(1280));
    m.insert("height".into(), json!(840));
    m
}

pub fn load_config() -> Map<String, Value> {
    let mut cfg = default_config();
    let p = config_path();
    if let Ok(raw) = std::fs::read(&p) {
        // utf-8-sig：容忍 BOM
        let raw = if raw.starts_with(b"\xef\xbb\xbf") {
            raw[3..].to_vec()
        } else {
            raw
        };
        if let Ok(data) = serde_json::from_slice::<Value>(&raw) {
            if let Value::Object(obj) = data {
                for (k, v) in obj {
                    cfg.insert(k, v);
                }
            }
        }
    }
    cfg
}

pub fn save_config(cfg: &Map<String, Value>) {
    let p = config_path();
    let tmp = p.with_extension("json.tmp");
    let text = match serde_json::to_string_pretty(&Value::Object(cfg.clone())) {
        Ok(t) => t,
        Err(_) => return,
    };
    if std::fs::write(&tmp, text.as_bytes())
        .and_then(|_| std::fs::rename(&tmp, &p))
        .is_err()
    {
        let _ = std::fs::remove_file(&tmp);
    }
}

pub fn get_i64<'a>(cfg: &'a Map<String, Value>, key: &str, dflt: i64) -> i64 {
    cfg.get(key).and_then(|v| v.as_i64()).unwrap_or(dflt)
}

pub fn get_str<'a>(cfg: &'a Map<String, Value>, key: &str, dflt: &str) -> String {
    cfg.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or(dflt)
        .to_string()
}

/// 启动参数解析：收集所有存在的非 "-" 开头参数。Windows 把文件拖到 exe 图标上
/// 时，每个被拖文件路径作为一个参数传入；多个文件时由前端把第一个有效文件
/// 打开在当前标签页、其余依次在后台标签页打开。
pub fn parse_startup_args(argv: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for arg in argv.iter().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let cleaned = arg.trim_matches('"');
        let p = Path::new(cleaned);
        if p.exists() {
            out.push(crate::files::resolve_path(p));
        }
    }
    out
}
