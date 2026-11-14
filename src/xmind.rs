//! .xmind 导入（只读）：兼容新版 content.json 与旧版 XMind 8 content.xml。
//! 行为逐条对齐原 app/main.py 的 parse_xmind_bytes 及其辅助函数。

use crate::mm::{marker_emoji, MmNode};
use crate::xml::XmlEl;
use std::io::Read;

/// 对齐 _strip_html：去掉所有 <...> 标签并 strip
fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut depth = 0usize;
    for ch in html.chars() {
        match ch {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            c if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out.trim().to_string()
}

fn base_node(text: &str) -> MmNode {
    MmNode::base(text)
}

/// 对齐 _compose_text：标记 emoji 前缀 + 标题 + [备注] + [标签]
fn compose_text(title: &str, notes: &str, labels: &[String], marker_ids: &[String]) -> String {
    let mut seen: Vec<&str> = Vec::new();
    for mid in marker_ids {
        if !mid.is_empty() && !seen.iter().any(|s| s == mid) {
            seen.push(mid);
        }
    }
    let prefix: String = seen
        .iter()
        .filter(|mid| !marker_emoji(mid).is_empty())
        .map(|mid| marker_emoji(mid))
        .collect();
    let mut text = if !prefix.is_empty() {
        format!("{} {}", prefix, title).trim().to_string()
    } else {
        title.to_string()
    };
    if !notes.is_empty() {
        text.push_str("\n[备注] ");
        text.push_str(notes);
    }
    if !labels.is_empty() {
        text.push_str("\n[标签] ");
        text.push_str(&labels.join("、"));
    }
    text
}

/// 对齐 _marker_ids_from_json：dict 值（字符串或 {markerId}）或 list（{markerId}）
fn marker_ids_from_json(markers: Option<&serde_json::Value>) -> Vec<String> {
    let mut ids = Vec::new();
    let Some(m) = markers else { return ids };
    match m {
        serde_json::Value::Object(map) => {
            for v in map.values() {
                match v {
                    serde_json::Value::String(s) => ids.push(s.clone()),
                    serde_json::Value::Object(o) => {
                        if let Some(mid) = o.get("markerId").and_then(|x| x.as_str()) {
                            ids.push(mid.to_string());
                        }
                    }
                    _ => {}
                }
            }
        }
        serde_json::Value::Array(list) => {
            for item in list {
                if let Some(mid) = item.get("markerId").and_then(|x| x.as_str()) {
                    ids.push(mid.to_string());
                }
            }
        }
        _ => {}
    }
    ids
}

fn json_str(v: Option<&serde_json::Value>) -> String {
    v.and_then(|x| x.as_str()).unwrap_or("").to_string()
}

/// 对齐 _xmind_json_topic
fn xmind_json_topic(t: &serde_json::Value) -> Option<MmNode> {
    let obj = t.as_object()?;
    let title = json_str(obj.get("title")).trim().to_string();
    let mut notes = String::new();
    if let Some(notes_obj) = obj.get("notes").and_then(|x| x.as_object()) {
        if let Some(content) = notes_obj
            .get("plain")
            .and_then(|p| p.get("content"))
            .and_then(|c| c.as_str())
        {
            if !content.is_empty() {
                notes = content.trim().to_string();
            }
        } else if let Some(html) = notes_obj.get("realHTML").and_then(|x| x.as_str()) {
            notes = strip_html(html);
        }
    }
    let labels: Vec<String> = obj
        .get("labels")
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|x| json_str(Some(x)))
                .filter(|s| !s.trim().is_empty())
                .collect()
        })
        .unwrap_or_default();
    let marker_ids = marker_ids_from_json(obj.get("markers"));
    let mut node = base_node(&compose_text(&title, &notes, &labels, &marker_ids));
    if let Some(children) = obj.get("children").and_then(|x| x.as_object()) {
        for key in ["attached", "detached"] {
            if let Some(list) = children.get(key).and_then(|x| x.as_array()) {
                for c in list {
                    if let Some(cn) = xmind_json_topic(c) {
                        node.children.push(cn);
                    }
                }
            }
        }
    }
    Some(node)
}

/// 对齐 _xmind_xml_topic
fn xmind_xml_topic(el: &XmlEl) -> MmNode {
    let title = el
        .find("title")
        .map(|t| t.itertext().trim().to_string())
        .unwrap_or_default();
    let mut notes = String::new();
    if let Some(notes_el) = el.find("notes") {
        if let Some(plain) = notes_el.find("plain") {
            notes = plain.itertext().trim().to_string();
        } else if let Some(html) = notes_el.find("html") {
            notes = strip_html(&html.itertext());
        }
    }
    let labels: Vec<String> = el
        .find("labels")
        .map(|ls| {
            ls.findall("label")
                .iter()
                .map(|l| l.itertext().trim().to_string())
                .filter(|s| !s.is_empty())
                .collect()
        })
        .unwrap_or_default();
    let mut marker_ids: Vec<String> = Vec::new();
    if let Some(refs_el) = el.find("marker-refs") {
        for m in refs_el.findall("marker-ref") {
            let mid = m
                .attr("marker-id")
                .or_else(|| m.attr("markerId"))
                .unwrap_or("");
            if !mid.is_empty() {
                marker_ids.push(mid.to_string());
            }
        }
    }
    let mut node = base_node(&compose_text(&title, &notes, &labels, &marker_ids));
    if let Some(children_el) = el.find("children") {
        for topics in children_el.findall("topics") {
            let ttype = topics.attr("type").unwrap_or("attached").trim().to_lowercase();
            if ttype == "attached" || ttype == "detached" {
                for t in topics.findall("topic") {
                    node.children.push(xmind_xml_topic(t));
                }
            }
        }
    }
    node
}

/// 对齐 parse_xmind_bytes：返回 (root, layout="", theme="")
pub fn parse_xmind_bytes(data: &[u8]) -> Result<(MmNode, String, String), String> {
    let reader = std::io::Cursor::new(data);
    let mut zf = zip::ZipArchive::new(reader)
        .map_err(|_| "文件已损坏或不是有效的 .xmind 压缩包".to_string())?;
    let names: Vec<String> = (0..zf.len())
        .filter_map(|i| {
            zf.by_index(i)
                .ok()
                .and_then(|f| f.name().ok().map(|n| n.into_owned()))
        })
        .collect();

    if names.iter().any(|n| n == "content.json") {
        let mut raw = Vec::new();
        zf.by_name("content.json")
            .map_err(|e| format!("content.json 读取失败：{}", e))?
            .read_to_end(&mut raw)
            .map_err(|e| format!("content.json 读取失败：{}", e))?;
        // utf-8-sig：剥离 BOM
        let text = if raw.starts_with(b"\xef\xbb\xbf") {
            String::from_utf8(raw[3..].to_vec())
        } else {
            String::from_utf8(raw)
        }
        .map_err(|e| format!("content.json 解析失败：{}", e))?;
        let sheets: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("content.json 解析失败：{}", e))?;
        let sheet = match sheets {
            serde_json::Value::Array(list) => list.first().cloned(),
            serde_json::Value::Object(_) => Some(sheets.clone()),
            _ => None,
        };
        let sheet = match sheet {
            Some(s) if s.is_object() => s,
            _ => return Err("content.json 中没有工作表（sheet）".into()),
        };
        let rt = sheet.get("rootTopic");
        let root = rt.and_then(xmind_json_topic);
        match root {
            Some(r) => Ok((r, String::new(), String::new())),
            None => Err("content.json 中没有 rootTopic（根主题）".into()),
        }
    } else if names.iter().any(|n| n == "content.xml") {
        let mut raw = Vec::new();
        zf.by_name("content.xml")
            .map_err(|e| format!("content.xml 读取失败：{}", e))?
            .read_to_end(&mut raw)
            .map_err(|e| format!("content.xml 读取失败：{}", e))?;
        let xml_el = crate::xml::parse_xml(&raw).map_err(|e| format!("content.xml 解析失败：{}", e))?;
        let sheet_el = if xml_el.local_tag() == "sheet" {
            Some(&xml_el)
        } else {
            find_descendant(&xml_el, "sheet")
        };
        let sheet_el = match sheet_el {
            Some(s) => s,
            None => return Err("content.xml 中没有工作表（sheet）".into()),
        };
        let topic_el = match sheet_el.find("topic") {
            Some(t) => t,
            None => return Err("content.xml 中没有根主题（topic）".into()),
        };
        Ok((xmind_xml_topic(topic_el), String::new(), String::new()))
    } else {
        Err("不是有效的 .xmind 文件（缺少 content.json / content.xml）".into())
    }
}

fn find_descendant<'a>(el: &'a XmlEl, tag: &str) -> Option<&'a XmlEl> {
    for c in &el.children {
        if c.local_tag() == tag {
            return Some(c);
        }
        if let Some(found) = find_descendant(c, tag) {
            return Some(found);
        }
    }
    None
}
