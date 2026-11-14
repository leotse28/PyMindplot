//! JS↔Rust 桥接：注入 pywebview 兼容垫片（window.pywebview.api），把原前端对
//! Python Api 的调用经 wry IPC 转发到 Rust 命令实现。方法名与返回结构逐一对齐
//! 原 app/main.py 的 Api 类。

use crate::assets;
use crate::config::{self, get_i64};
use crate::files;
use serde_json::{json, Map, Value};
use std::cell::{Cell, RefCell};
use std::rc::Rc;
use wry::WebView;

/// 注入到页面的垫片：在 document 创建时定义 window.pywebview.api，
/// 方法调用返回 Promise，经 window.ipc.postMessage 发往 Rust，由
/// window.__rustplot.resolve(id, value) 兑现。允许 JS 覆写单个方法
/// （自检流程会覆写 get_save_path）。
pub const BRIDGE_JS: &str = r#"(function () {
  'use strict';
  if (window.__RUSTPLOT_BRIDGE__) return;
  window.__RUSTPLOT_BRIDGE__ = true;
  var pending = Object.create(null);
  var seq = 0;
  window.__rustplot = {
    resolve: function (id, value) {
      var cb = pending[id];
      if (cb) { delete pending[id]; cb(value); }
    }
  };
  function call(method, args) {
    return new Promise(function (resolve) {
      var id = String(++seq);
      pending[id] = resolve;
      try {
        window.ipc.postMessage(JSON.stringify({ id: id, method: method, args: args }));
      } catch (err) {
        delete pending[id];
        resolve(null);
      }
    });
  }
  var METHODS = ['set_dirty','get_config','set_config','get_version','take_startup_files',
    'pick_open_file','get_save_path','get_save_path_any','save_attachment_as',
    'add_attachment_data','load_map','save_map','add_attachment','open_attachment',
    'add_image','read_image_data','save_png','pick_attachment_file','report_selftest'];
  var apiObj = {};
  METHODS.forEach(function (m) {
    apiObj[m] = function () { return call(m, Array.prototype.slice.call(arguments)); };
  });
  window.pywebview = { api: apiObj };
})();"#;

pub struct AppState {
    pub cfg: RefCell<Map<String, Value>>,
    pub dirty: Cell<bool>,
    /// 启动文件队列（exe 拖放 / 命令行参数），由 take_startup_files 一次性取走
    pub startup_files: RefCell<Vec<String>>,
}

impl AppState {
    pub fn new(startup_files: Vec<String>) -> Rc<Self> {
        Rc::new(AppState {
            cfg: RefCell::new(config::load_config()),
            dirty: Cell::new(false),
            startup_files: RefCell::new(startup_files),
        })
    }
}

fn arg_str(args: &[Value], i: usize) -> String {
    args.get(i)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn arg_truthy(args: &[Value], i: usize) -> bool {
    match args.get(i) {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty() && s != "false" && s != "0",
        Some(Value::Null) => false,
        Some(Value::Object(_)) | Some(Value::Array(_)) => true,
        None => false,
    }
}

// ── 对话框（对齐 pywebview create_file_dialog 行为）─────────

const MAP_FILTERS: [(&str, [&str; 3]); 1] = [("思维导图", ["mm", "xml", "xmind"])];

fn pick_open_dialog() -> Option<String> {
    let mut dlg = rfd::FileDialog::new();
    for (name, exts) in MAP_FILTERS {
        dlg = dlg.add_filter(name, &exts);
    }
    dlg.add_filter("所有文件", &["*"]).pick_file().map(|p| files::resolve_path(&p))
}

fn save_map_dialog(default_name: &str) -> Option<String> {
    let mut dlg = rfd::FileDialog::new();
    for (name, exts) in MAP_FILTERS {
        dlg = dlg.add_filter(name, &exts);
    }
    dlg.add_filter("所有文件", &["*"])
        .set_file_name(if default_name.is_empty() { "未命名.mm" } else { default_name })
        .save_file()
        .map(|p| files::normalize_map_path(&files::resolve_path(&p)))
}

fn save_any_dialog(default_name: &str) -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("所有文件", &["*"])
        .set_file_name(if default_name.is_empty() { "附件" } else { default_name })
        .save_file()
        .map(|p| files::resolve_path(&p))
}

fn pick_any_dialog() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("所有文件", &["*"])
        .pick_file()
        .map(|p| files::resolve_path(&p))
}

// ── 命令实现 ─────────────────────────────────────────────────

fn cmd_load_map(path: &str) -> Value {
    match files::load_map_file(path) {
        Ok(doc) => json!({
            "ok": true,
            "path": doc.path,
            "name": doc.name,
            "format": doc.format,
            "root": serde_json::to_value(doc.root).unwrap_or(Value::Null),
            "layout": doc.layout,
            "theme": doc.theme,
        }),
        Err(e) => json!({"ok": false, "error": e, "path": path}),
    }
}

fn cmd_report_selftest(results: &Value) -> Value {
    let out = config::config_dir().join("selftest-result.json");
    match serde_json::to_string_pretty(results)
        .map_err(|e| e.to_string())
        .and_then(|text| std::fs::write(&out, text.as_bytes()).map_err(|e| e.to_string()))
    {
        Ok(_) => json!(true),
        Err(_) => json!(false),
    }
}

/// 分发一条 IPC 请求并经 evaluate_script 回送结果
pub fn handle(webview: &WebView, state: &Rc<AppState>, body: &str) {
    let req: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return,
    };
    let id = req.get("id").cloned().unwrap_or(Value::Null);
    let method = req.get("method").and_then(|v| v.as_str()).unwrap_or("");
    let args: Vec<Value> = req
        .get("args")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let result: Value = match method {
        "set_dirty" => {
            state.dirty.set(arg_truthy(&args, 0));
            json!({"ok": true, "dirty": state.dirty.get()})
        }
        "get_config" => Value::Object(state.cfg.borrow().clone()),
        "set_config" => {
            if let Some(patch) = args.first().and_then(|v| v.as_object()) {
                {
                    let mut cfg = state.cfg.borrow_mut();
                    for (k, v) in patch {
                        cfg.insert(k.clone(), v.clone());
                    }
                }
                let snapshot = state.cfg.borrow().clone();
                config::save_config(&snapshot);
            }
            Value::Object(state.cfg.borrow().clone())
        }
        "get_version" => json!({"name": crate::mm::APP_NAME, "version": crate::mm::APP_VERSION}),
        "take_startup_files" => {
            let files = std::mem::take(&mut *state.startup_files.borrow_mut());
            Value::Array(files.into_iter().map(Value::String).collect())
        }
        "pick_open_file" => pick_open_dialog().map(Value::String).unwrap_or(Value::Null),
        "get_save_path" => {
            let d = arg_str(&args, 0);
            save_map_dialog(&d).map(Value::String).unwrap_or(Value::Null)
        }
        "get_save_path_any" => {
            let d = arg_str(&args, 0);
            save_any_dialog(&d).map(Value::String).unwrap_or(Value::Null)
        }
        "pick_attachment_file" => pick_any_dialog().map(Value::String).unwrap_or(Value::Null),
        "load_map" => cmd_load_map(&arg_str(&args, 0)),
        "save_map" => {
            let path = arg_str(&args, 0);
            let payload = args.get(1).cloned().unwrap_or(Value::Null);
            files::save_map_file(&path, &payload)
        }
        "add_attachment" => files::add_attachment_file(&arg_str(&args, 0), &arg_str(&args, 1)),
        "add_attachment_data" => files::add_attachment_data_file(
            &arg_str(&args, 0),
            &arg_str(&args, 1),
            &arg_str(&args, 2),
        ),
        "save_attachment_as" => {
            let map_path = arg_str(&args, 0);
            let entry = args.get(1).cloned().unwrap_or(Value::Null);
            let dest = arg_str(&args, 2);
            files::save_attachment_file(&map_path, &entry, &dest)
        }
        "open_attachment" => {
            let map_path = arg_str(&args, 0);
            let entry = args.get(1).cloned().unwrap_or(Value::Null);
            files::open_attachment_file(&map_path, &entry)
        }
        "add_image" => {
            let map_path = arg_str(&args, 0);
            let data = arg_str(&args, 1);
            let ext = arg_str(&args, 2);
            files::add_image_file(&map_path, &data, if ext.is_empty() { "png" } else { &ext })
        }
        "read_image_data" => files::read_image_data(&arg_str(&args, 0), &arg_str(&args, 1)),
        "save_png" => files::save_png_file(&arg_str(&args, 0), &arg_str(&args, 1)),
        "report_selftest" => cmd_report_selftest(args.first().unwrap_or(&Value::Null)),
        _ => Value::Null,
    };

    let id_json = serde_json::to_string(&id).unwrap_or_else(|_| "null".into());
    let value_json = serde_json::to_string(&result).unwrap_or_else(|_| "null".into());
    let script = format!("window.__rustplot.resolve({}, {});", id_json, value_json);
    let _ = webview.evaluate_script(&script);
}

/// 拖放悬停提示开关（Windows 下 wry 接管原生拖放，HTML5 拖放事件不可用，
/// 提示由 Rust 端 DragDropEvent 驱动）
pub fn set_drop_hint(webview: &WebView, show: bool) {
    let _ = webview.evaluate_script(&format!(
        "window.__MM_DROP_HINT__ && window.__MM_DROP_HINT__({})",
        show
    ));
}

/// 把拖放到窗口的文件路径列表转发给前端打开
pub fn forward_dropped_files(webview: &WebView, paths: &[std::path::PathBuf]) {
    let arr: Vec<Value> = paths
        .iter()
        .map(|p| json!(p.to_string_lossy().to_string()))
        .collect();
    let script = format!(
        "window.__MM_DROP_OPEN__ && window.__MM_DROP_OPEN__({})",
        serde_json::to_string(&arr).unwrap_or_else(|_| "[]".into())
    );
    let _ = webview.evaluate_script(&script);
}

/// 读取窗口尺寸配置（供 main 使用）
pub fn window_size(state: &Rc<AppState>) -> (i64, i64) {
    let cfg = state.cfg.borrow();
    (
        get_i64(&cfg, "width", 1280).max(200),
        get_i64(&cfg, "height", 840).max(200),
    )
}

/// 供 main 组装 URL 使用
pub fn index_url() -> &'static str {
    assets::INDEX_URL
}
