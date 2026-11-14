//! 导图数据模型与 FreeMind 格式（.mm/.xml）解析、序列化。
//! 行为逐条对齐原 app/main.py 中的 parse_node / parse_map_bytes / build_node_el / serialize_mm。

use crate::xml::{escape_attr, ind, parse_xml, XmlEl};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::{Deserialize, Serialize};

pub const APP_NAME: &str = "PyMindplot";
pub const APP_VERSION: &str = "1.26.0";
pub const CONFIG_FILENAME: &str = "app.config.json";
pub const LAYOUTS: [&str; 6] = [
    "map-balance",
    "map-right",
    "org-down",
    "tree-right",
    "timeline",
    "fishbone",
];

pub const MARKER_EMOJI: [(&str, &str); 12] = [
    ("priority-1", "➊"),
    ("priority-2", "➋"),
    ("priority-3", "➌"),
    ("priority-4", "➍"),
    ("priority-5", "➎"),
    ("priority-6", "➏"),
    ("star-red", "⭐"),
    ("star-yellow", "⭐"),
    ("flag-red", "🚩"),
    ("flag-orange", "🚩"),
    ("task-done", "✅"),
    ("task-start", "🚀"),
];

pub fn marker_emoji(id: &str) -> &'static str {
    MARKER_EMOJI
        .iter()
        .find(|(k, _)| *k == id)
        .map(|(_, v)| *v)
        .unwrap_or("")
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Attach {
    pub name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub rel: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub data: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MmNode {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub children: Vec<MmNode>,
    #[serde(default)]
    pub collapsed: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub bg: String,
    #[serde(default)]
    pub bold: bool,
    #[serde(default)]
    pub fs: f64,
    #[serde(default)]
    pub it: bool,
    #[serde(default)]
    pub ul: bool,
    #[serde(default)]
    pub latex: String,
    #[serde(default)]
    pub img: String,
    #[serde(default)]
    pub imgdata: String,
    #[serde(default)]
    pub w: f64,
    #[serde(default)]
    pub h: f64,
    #[serde(default)]
    pub attach: Vec<Attach>,
}

impl MmNode {
    pub fn base(text: &str) -> Self {
        MmNode {
            text: text.to_string(),
            ..Default::default()
        }
    }

    pub fn count_nodes(&self) -> usize {
        1 + self.children.iter().map(MmNode::count_nodes).sum::<usize>()
    }
}

// ── 属性清洗（对齐 main.py 的辅助函数）──────────────────────

pub fn clean_color(v: &str) -> String {
    let s = v.trim();
    if s.is_empty() || !s.starts_with('#') {
        return String::new();
    }
    s.to_uppercase()
}

pub fn pos_num(v: &str) -> f64 {
    match v.trim().parse::<f64>() {
        Ok(f) if f > 0.0 => f,
        _ => 0.0,
    }
}

fn attr_true(v: &str) -> bool {
    v.trim().eq_ignore_ascii_case("true")
}

fn node_text(el: &XmlEl) -> String {
    if let Some(t) = el.attr("TEXT") {
        if !t.is_empty() {
            return t.to_string();
        }
    }
    for rc in el.findall("richcontent") {
        let ty = rc.attr("TYPE").unwrap_or("NODE");
        if ty == "NODE" || ty == "DETAILS" {
            let txt = rc.itertext().trim().to_string();
            if !txt.is_empty() {
                return txt;
            }
        }
    }
    String::new()
}

// ── ATTACHMENTS 编解码 ───────────────────────────────────────

/// Python json.dumps(..., ensure_ascii=False) 的字符串转义
pub fn py_json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// 对齐 _encode_attachments：仅保留 name+data 或 name+rel 的条目
pub fn encode_attachments(attach: &[Attach]) -> Option<String> {
    let mut items: Vec<String> = Vec::new();
    for a in attach {
        let name = a.name.trim();
        let rel = a.rel.trim();
        let data = a.data.trim();
        if !name.is_empty() && !data.is_empty() {
            items.push(format!(
                "{{\"name\": {}, \"data\": {}}}",
                py_json_str(name),
                py_json_str(data)
            ));
        } else if !name.is_empty() && !rel.is_empty() {
            items.push(format!(
                "{{\"name\": {}, \"rel\": {}}}",
                py_json_str(name),
                py_json_str(rel)
            ));
        }
    }
    if items.is_empty() {
        return None;
    }
    let raw = format!("[{}]", items.join(", "));
    Some(B64.encode(raw.as_bytes()))
}

/// 对齐 _decode_attachments：坏数据一律返回空列表
pub fn decode_attachments(v: &str) -> Vec<Attach> {
    let raw = match B64.decode(v.as_bytes()) {
        Ok(raw) => raw,
        Err(_) => return Vec::new(),
    };
    let text = match String::from_utf8(raw) {
        Ok(t) => t,
        Err(_) => return Vec::new(),
    };
    let items: serde_json::Value = match serde_json::from_str(&text) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    if let serde_json::Value::Array(list) = items {
        for a in list {
            let obj = match a {
                serde_json::Value::Object(o) => o,
                _ => continue,
            };
            let name = match obj.get("name").and_then(|x| x.as_str()) {
                Some(n) if !n.is_empty() => n.to_string(),
                _ => continue,
            };
            let data = obj
                .get("data")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            let rel = obj
                .get("rel")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            if data.is_empty() && rel.is_empty() {
                continue;
            }
            out.push(Attach { name, rel, data });
        }
    }
    out
}

// ── 解析 ─────────────────────────────────────────────────────

pub fn parse_node(el: &XmlEl) -> MmNode {
    let mut node = MmNode {
        text: node_text(el),
        collapsed: el.attr("FOLDED").map(attr_true).unwrap_or(false),
        color: clean_color(el.attr("COLOR").unwrap_or("")),
        bg: clean_color(el.attr("BACKGROUND_COLOR").unwrap_or("")),
        ul: el.attr("UNDERLINE").map(attr_true).unwrap_or(false),
        latex: el.attr("LATEX").unwrap_or("").to_string(),
        img: el.attr("IMAGE").unwrap_or("").to_string(),
        imgdata: el.attr("IMGDATA").unwrap_or("").to_string(),
        w: pos_num(el.attr("WIDTH").unwrap_or("")),
        h: pos_num(el.attr("HEIGHT").unwrap_or("")),
        attach: decode_attachments(el.attr("ATTACHMENTS").unwrap_or("")),
        ..Default::default()
    };
    for f in el.findall("font") {
        if let Some(sz) = f.attr("SIZE") {
            if let Ok(n) = sz.trim().parse::<i64>() {
                if n > 12 {
                    node.fs = n as f64;
                }
            }
        }
        if f.attr("BOLD").map(attr_true).unwrap_or(false) {
            node.bold = true;
        }
        if f.attr("ITALIC").map(attr_true).unwrap_or(false) {
            node.it = true;
        }
    }
    for child in el.findall("node") {
        node.children.push(parse_node(child));
    }
    node
}

pub struct ParsedMap {
    pub root: MmNode,
    pub layout: String,
    pub theme: String,
}

/// 对齐 parse_map_bytes：根元素为 <map> 或 <node>
pub fn parse_map_bytes(data: &[u8]) -> Result<ParsedMap, String> {
    let root_el = parse_xml(data)?;
    let tag = root_el.tag.as_str();
    if tag == "map" {
        let first = match root_el.find("node") {
            Some(n) => n,
            None => return Err("map 元素下没有 node 节点".into()),
        };
        let root = parse_node(first);
        let layout = root_el.attr("layout").unwrap_or("").trim().to_string();
        let theme = root_el.attr("theme").unwrap_or("").trim().to_string();
        let layout = if LAYOUTS.contains(&layout.as_str()) {
            layout
        } else {
            String::new()
        };
        let theme = theme.chars().take(24).collect();
        Ok(ParsedMap { root, layout, theme })
    } else if tag == "node" {
        Ok(ParsedMap {
            root: parse_node(&root_el),
            layout: String::new(),
            theme: String::new(),
        })
    } else {
        Err(format!("无法识别的根元素: <{}>", tag))
    }
}

// ── 序列化 ───────────────────────────────────────────────────

/// 对齐 build_node_el：属性顺序 TEXT, COLOR, BACKGROUND_COLOR, FOLDED, WIDTH,
/// HEIGHT, UNDERLINE, LATEX, IMAGE, IMGDATA, ATTACHMENTS；font 子元素属性顺序
/// BOLD, SIZE, ITALIC, NAME（NAME 由 setdefault 追加在最后）。
/// 写入元素本体（不含前导缩进，缩进由父级 tail / 顶层调用方控制）。
fn build_node_el_body(out: &mut String, node: &MmNode, depth: usize) {
    out.push_str("<node TEXT=\"");
    out.push_str(&escape_attr(&node.text));
    out.push('"');
    let color = clean_color(&node.color);
    if !color.is_empty() {
        out.push_str(" COLOR=\"");
        out.push_str(&escape_attr(&color));
        out.push('"');
    }
    let bg = clean_color(&node.bg);
    if !bg.is_empty() {
        out.push_str(" BACKGROUND_COLOR=\"");
        out.push_str(&escape_attr(&bg));
        out.push('"');
    }
    if node.collapsed {
        out.push_str(" FOLDED=\"true\"");
    }
    if node.w > 0.0 {
        out.push_str(&format!(" WIDTH=\"{}\"", node.w.round() as i64));
    }
    if node.h > 0.0 {
        out.push_str(&format!(" HEIGHT=\"{}\"", node.h.round() as i64));
    }
    if node.ul {
        out.push_str(" UNDERLINE=\"true\"");
    }
    let latex = node.latex.trim();
    if !latex.is_empty() {
        out.push_str(" LATEX=\"");
        out.push_str(&escape_attr(latex));
        out.push('"');
    }
    let img = node.img.trim();
    if !img.is_empty() {
        out.push_str(" IMAGE=\"");
        out.push_str(&escape_attr(img));
        out.push('"');
    }
    let imgdata = node.imgdata.trim();
    if !imgdata.is_empty() {
        out.push_str(" IMGDATA=\"");
        out.push_str(&escape_attr(imgdata));
        out.push('"');
    }
    if let Some(enc) = encode_attachments(&node.attach) {
        out.push_str(" ATTACHMENTS=\"");
        out.push_str(&escape_attr(&enc));
        out.push('"');
    }
    let mut font_attrs: Vec<(&str, String)> = Vec::new();
    if node.bold {
        font_attrs.push(("BOLD", "true".into()));
    }
    if node.fs > 12.0 {
        font_attrs.push(("SIZE", format!("{}", node.fs as i64)));
    }
    if node.it {
        font_attrs.push(("ITALIC", "true".into()));
    }
    if node.children.is_empty() && font_attrs.is_empty() {
        out.push_str(" />");
        return;
    }
    out.push('>');
    if !font_attrs.is_empty() {
        out.push_str("\n");
        out.push_str(ind(depth + 1));
        out.push_str("<font");
        for (k, v) in &font_attrs {
            out.push_str(&format!(" {}=\"{}\"", k, v));
        }
        out.push_str(" NAME=\"SansSerif\" />");
    }
    let n = node.children.len();
    for (i, child) in node.children.iter().enumerate() {
        out.push('\n');
        out.push_str(ind(if i + 1 < n { depth + 1 } else { depth }));
        build_node_el_body(out, child, depth + 1);
    }
    out.push_str("\n");
    out.push_str(ind(depth));
    out.push_str("</node>");
}

/// 对齐 serialize_mm：<?xml version='1.0' encoding='UTF-8'?>\n<map ...>...</map>
pub fn serialize_mm(root: &MmNode, layout: &str, theme: &str) -> Vec<u8> {
    let mut out = String::new();
    out.push_str("<?xml version='1.0' encoding='UTF-8'?>\n");
    out.push_str("<map version=\"1.0.1\"");
    if LAYOUTS.contains(&layout) {
        out.push_str(&format!(" layout=\"{}\"", escape_attr(layout)));
    }
    if !theme.is_empty() {
        let t: String = theme.chars().take(24).collect();
        out.push_str(&format!(" theme=\"{}\"", escape_attr(&t)));
    }
    out.push('>');
    // 根节点：text = "\n  "（ET.indent），tail = "\n"
    out.push('\n');
    out.push_str(ind(1));
    build_node_el_body(&mut out, root, 1);
    out.push('\n');
    out.push_str("</map>");
    out.into_bytes()
}
