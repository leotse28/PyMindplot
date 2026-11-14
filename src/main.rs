//! RustMindPlot —— PyMindplot 的 Rust 移植版。
//! 原生窗口（tao）承载本地 HTML/CSS/JS 界面（WebView2，经 wry），
//! 文件解析/保存、附件、对话框、自检等原 Python 壳职责全部由 Rust 实现。
//! release 构建为窗口子系统（无控制台），debug 保留控制台便于诊断。

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use rustmindplot::bridge::{self, AppState, BRIDGE_JS};
use rustmindplot::config;
use serde_json::json;
use std::cell::RefCell;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::platform::windows::WindowExtWindows;
use tao::window::WindowBuilder;
use wry::WebView;

static SELFTEST_DONE: AtomicBool = AtomicBool::new(false);

/// 内嵌应用图标（与 build.rs 嵌入 EXE 资源的是同一文件）：
/// EXE 资源图标只作用于资源管理器，窗口标题栏/任务栏图标需运行时另行设置。
/// .ico 条目为 PNG 压缩（8-bit RGBA），容器解析在此手写、条目解码用 png crate
/// （镜像源无 ico crate，png 已在本地依赖图内）
const ICON_ICO: &[u8] = include_bytes!("../assets/icon.ico");

/// 取 .ico 中指定边长条目的 PNG 字节；无该尺寸时退回最大条目
fn ico_entry(bytes: &[u8], want: u32) -> Option<&[u8]> {
    if bytes.len() < 6 {
        return None;
    }
    let count = u16::from_le_bytes([bytes[4], bytes[5]]) as usize;
    let mut largest: Option<(u32, usize, usize)> = None;
    for i in 0..count {
        let o = 6 + 16 * i;
        if o + 16 > bytes.len() {
            break;
        }
        let side = if bytes[o] == 0 { 256 } else { u32::from(bytes[o]) };
        let len = u32::from_le_bytes(bytes[o + 8..o + 12].try_into().ok()?) as usize;
        let off = u32::from_le_bytes(bytes[o + 12..o + 16].try_into().ok()?) as usize;
        if off + len > bytes.len() {
            continue;
        }
        if side == want {
            return Some(&bytes[off..off + len]);
        }
        if largest.is_none_or(|(s, _, _)| side > s) {
            largest = Some((side, off, len));
        }
    }
    largest.map(|(_, off, len)| &bytes[off..off + len])
}

/// 解码 PNG 字节为 RGBA（条目均为 8-bit；RGB/灰度兜底展开，其余颜色类型跳过）
fn decode_png_rgba(data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let mut reader = png::Decoder::new(std::io::Cursor::new(data)).read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let src = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => src.to_vec(),
        png::ColorType::Rgb => src
            .chunks_exact(3)
            .flat_map(|p| [p[0], p[1], p[2], 255])
            .collect(),
        png::ColorType::GrayscaleAlpha => src
            .chunks_exact(2)
            .flat_map(|p| [p[0], p[0], p[0], p[1]])
            .collect(),
        png::ColorType::Grayscale => src.iter().flat_map(|g| [*g, *g, *g, 255]).collect(),
        _ => return None,
    };
    Some((info.width, info.height, rgba))
}

/// 从内嵌 .ico 解码指定边长的条目为窗口图标；无该尺寸时退回最大条目
fn decode_icon(size: u32) -> Option<tao::window::Icon> {
    let data = ico_entry(ICON_ICO, size)?;
    let (w, h, rgba) = decode_png_rgba(data)?;
    tao::window::Icon::from_rgba(rgba, w, h).ok()
}

fn confirm_exit() -> bool {
    use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
    let res = MessageDialog::new()
        .set_level(MessageLevel::Warning)
        .set_title("PyMindplot")
        .set_description(
            "当前导图有未保存的修改（可能包含未保存的附件关联）。\n\
             退出将丢失这些修改，建议先 Ctrl+S 保存。\n\n确定要退出吗？",
        )
        .set_buttons(MessageButtons::OkCancel)
        .show();
    matches!(res, MessageDialogResult::Ok | MessageDialogResult::Yes)
}

fn main() {
    let argv: Vec<String> = std::env::args().collect();
    let selftest = argv.iter().any(|a| a == "--selftest");
    let startup_files = if selftest {
        Vec::new()
    } else {
        config::parse_startup_args(&argv)
    };

    let state = AppState::new(startup_files);

    let index_url = if selftest {
        format!("{}#selftest=1", rustmindplot::assets::INDEX_URL)
    } else {
        rustmindplot::assets::INDEX_URL.to_string()
    };

    let event_loop = EventLoop::new();
    let (win_w, win_h) = bridge::window_size(&state);
    let window = WindowBuilder::new()
        .with_title("PyMindplot")
        .with_inner_size(LogicalSize::new(win_w as f64, win_h as f64))
        .with_min_inner_size(LogicalSize::new(760.0, 540.0))
        // 标题栏小图标取 32×32（GDI 缩到 16/20/24 无损观感）
        .with_window_icon(decode_icon(32))
        .build(&event_loop)
        .expect("无法创建窗口");
    // 任务栏大图标：tao 0.37 无 builder 方法，创建后设置（取 256×256 由系统缩放）
    window.set_taskbar_icon(decode_icon(256));
    window.set_focus();

    // IPC 处理器在 webview 构建前注册，用 Rc 单元在构建后回填 webview 引用
    let webview_cell: Rc<RefCell<Option<Rc<WebView>>>> = Rc::new(RefCell::new(None));
    let webview_for_ipc = webview_cell.clone();
    let webview_for_drag = webview_cell.clone();
    let state_for_ipc = state.clone();
    let webview = Rc::new(
        wry::WebViewBuilder::new()
            .with_url(&index_url)
            .with_initialization_script(BRIDGE_JS)
            .with_custom_protocol(
                rustmindplot::assets::PROTOCOL.to_string(),
                move |_id, req: http::Request<Vec<u8>>| {
                    let path = req.uri().to_string();
                    // 处理器收到的 URI 已还原为 app://localhost/... 形式
                    let path = path
                        .split_once("://")
                        .and_then(|(_, rest)| rest.split_once('/'))
                        .map(|(_, p)| format!("/{}", p))
                        .unwrap_or_else(|| "/".to_string());
                    rustmindplot::assets::serve(&path)
                },
            )
            .with_ipc_handler(move |req| {
                let Some(wv) = webview_for_ipc.borrow().clone() else {
                    return;
                };
                bridge::handle(&wv, &state_for_ipc, req.into_body().as_str());
            })
            // 文件拖进窗口：悬停显示可放置提示，松开转发路径给前端打开
            // （Windows 下 wry 接管原生拖放并禁用 HTML5 拖放事件）
            .with_drag_drop_handler(move |ev| {
                if let Some(wv) = webview_for_drag.borrow().clone() {
                    match ev {
                        wry::DragDropEvent::Enter { .. } => bridge::set_drop_hint(&wv, true),
                        wry::DragDropEvent::Leave => bridge::set_drop_hint(&wv, false),
                        wry::DragDropEvent::Drop { paths, .. } => {
                            bridge::set_drop_hint(&wv, false);
                            bridge::forward_dropped_files(&wv, &paths);
                        }
                        _ => {}
                    }
                }
                true
            })
            .with_background_color((244, 246, 251, 255))
            .with_incognito(true)
            .build(&window)
            .expect("无法创建 WebView"),
    );
    *webview_cell.borrow_mut() = Some(webview.clone());
    window.set_focus();

    let mut last_size = window.inner_size();
    let mut last_poll = Instant::now();
    let mut poll_count: u32 = 0;
    let mut selftest_finished = false;

    event_loop.run(move |event, _, control_flow| {
        match event {
            Event::NewEvents(StartCause::Init) => {
                *control_flow = if selftest {
                    ControlFlow::Poll
                } else {
                    ControlFlow::Wait
                };
            }
            Event::WindowEvent { window_id, event, .. } if window_id == window.id() => {
                match event {
                    WindowEvent::Resized(size) => {
                        last_size = size;
                    }
                    WindowEvent::CloseRequested => {
                        let allow = if selftest || !state.dirty.get() {
                            true
                        } else {
                            confirm_exit()
                        };
                        if allow {
                            *control_flow = ControlFlow::Exit;
                        }
                    }
                    _ => {}
                }
            }
            Event::MainEventsCleared => {
                if selftest && !selftest_finished {
                    if SELFTEST_DONE.load(Ordering::Relaxed) {
                        selftest_finished = true;
                        *control_flow = ControlFlow::Exit;
                    } else if last_poll.elapsed() >= Duration::from_millis(150) {
                        last_poll = Instant::now();
                        poll_count += 1;
                        if poll_count > 100 {
                            let out = config::config_dir().join("selftest-result.json");
                            let _ = std::fs::write(
                                &out,
                                "{\"error\":\"selftest timeout\",\"total\":false}",
                            );
                            selftest_finished = true;
                            *control_flow = ControlFlow::Exit;
                        } else {
                            let _ = webview.evaluate_script_with_callback(
                                "(window.__SELFTEST__ ? JSON.stringify(window.__SELFTEST__) : '')",
                                |raw| {
                                    if raw.is_empty() || raw == "\"\"" || raw == "null" {
                                        return;
                                    }
                                    // ResultAsJson 把字符串结果再包一层 JSON 字符串字面量
                                    let inner = match serde_json::from_str::<String>(&raw) {
                                        Ok(s) => s,
                                        Err(_) => return,
                                    };
                                    if inner.is_empty() {
                                        return;
                                    }
                                    let out = config::config_dir().join("selftest-result.json");
                                    if std::fs::write(&out, inner.as_bytes()).is_ok() {
                                        SELFTEST_DONE.store(true, Ordering::Relaxed);
                                    }
                                },
                            );
                        }
                    }
                }
            }
            Event::LoopDestroyed => {
                if !selftest {
                    let scale = window.scale_factor();
                    let w = (last_size.width as f64 / scale).round() as i64;
                    let h = (last_size.height as f64 / scale).round() as i64;
                    {
                        let mut cfg = state.cfg.borrow_mut();
                        cfg.insert("width".into(), json!(w));
                        cfg.insert("height".into(), json!(h));
                    }
                    let snapshot = state.cfg.borrow().clone();
                    config::save_config(&snapshot);
                }
            }
            _ => {}
        }
    });
}
