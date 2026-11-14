//! 极简 XML DOM：基于 quick-xml，行为对齐本项目用到的 xml.etree.ElementTree 子集。
//! 解析：标签/属性/文本（含实体与 CDATA）；序列化：与 ET.tostring(indent) 输出逐字节兼容。

use quick_xml::events::Event;
use quick_xml::Reader;

#[derive(Debug, Clone, Default)]
pub struct XmlEl {
    pub tag: String,
    pub attrs: Vec<(String, String)>,
    /// 该元素的直接文本（多个文本块按序拼接）
    pub text: String,
    pub children: Vec<XmlEl>,
}

impl XmlEl {
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }

    /// 直接子元素中标签名匹配者（ET 的 findall 语义）
    pub fn findall(&self, tag: &str) -> Vec<&XmlEl> {
        self.children.iter().filter(|c| c.tag == tag).collect()
    }

    pub fn find(&self, tag: &str) -> Option<&XmlEl> {
        self.children.iter().find(|c| c.tag == tag)
    }

    /// ET 的 itertext：元素自身文本 + 所有子孙文本，按文档序拼接
    pub fn itertext(&self) -> String {
        let mut out = String::new();
        fn rec(el: &XmlEl, out: &mut String) {
            out.push_str(&el.text);
            for c in &el.children {
                rec(c, out);
            }
        }
        rec(self, &mut out);
        out
    }

    /// 命名空间本地名：兼容 ET 的 "{uri}local" 与带前缀 "prefix:local"
    pub fn local_tag(&self) -> &str {
        let t = &self.tag;
        let t = match t.rfind('}') {
            Some(i) => &t[i + 1..],
            None => t,
        };
        match t.rfind(':') {
            Some(i) => &t[i + 1..],
            None => t,
        }
    }
}

/// 解析 XML 字节为 DOM 根元素。失败时返回错误信息（对齐 ET.fromstring 的"抛错"行为）。
pub fn parse_xml(data: &[u8]) -> Result<XmlEl, String> {
    let mut reader = Reader::from_reader(data);
    reader.config_mut().check_end_names = true;
    let mut stack: Vec<XmlEl> = Vec::new();
    let mut root: Option<XmlEl> = None;
    let mut buf = Vec::new();
    loop {
        let ev = match reader.read_event_into(&mut buf) {
            Ok(ev) => ev,
            Err(e) => return Err(format!("XML 解析失败：{}", e)),
        };
        let is_empty = matches!(ev, Event::Empty(_));
        match ev {
            Event::Start(e) | Event::Empty(e) => {
                let tag = String::from_utf8_lossy(e.name().as_ref()).into_owned();
                let mut attrs = Vec::new();
                for a in e.attributes() {
                    let a = a.map_err(|err| format!("XML 解析失败：{}", err))?;
                    let key = String::from_utf8_lossy(a.key.as_ref()).into_owned();
                    let val = a
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|err| format!("XML 解析失败：{}", err))?
                        .into_owned();
                    attrs.push((key, val));
                }
                let el = XmlEl {
                    tag,
                    attrs,
                    text: String::new(),
                    children: Vec::new(),
                };
                if is_empty {
                    push_el(&mut stack, &mut root, el)?;
                } else {
                    stack.push(el);
                }
            }
            Event::Text(t) => {
                let s = t
                    .unescape()
                    .map_err(|err| format!("XML 解析失败：{}", err))?
                    .into_owned();
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&s);
                }
            }
            Event::CData(t) => {
                let s = String::from_utf8_lossy(t.as_ref()).into_owned();
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&s);
                }
            }
            Event::End(_) => {
                let el = match stack.pop() {
                    Some(el) => el,
                    None => return Err("XML 解析失败：意外的结束标签".into()),
                };
                push_el(&mut stack, &mut root, el)?;
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err("XML 解析失败：存在未闭合的元素".into());
    }
    match root {
        Some(r) => Ok(r),
        None => Err("XML 解析失败：空文档".into()),
    }
}

fn push_el(stack: &mut Vec<XmlEl>, root: &mut Option<XmlEl>, el: XmlEl) -> Result<(), String> {
    if let Some(top) = stack.last_mut() {
        top.children.push(el);
    } else {
        if root.is_some() {
            return Err("XML 解析失败：文档包含多个根元素".into());
        }
        *root = Some(el);
    }
    Ok(())
}

// ── ET 兼容序列化 ─────────────────────────────────────────────

/// ET _escape_cdata：& < >
pub fn escape_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

/// ET _escape_attrib：& < > " \r \n \t
pub fn escape_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\r' => out.push_str("&#13;"),
            '\n' => out.push_str("&#10;"),
            '\t' => out.push_str("&#09;"),
            _ => out.push(ch),
        }
    }
    out
}

pub fn ind(depth: usize) -> &'static str {
    const SPACES: &str = "                                                                ";
    let n = (depth * 2).min(SPACES.len());
    &SPACES[..n]
}

/// 序列化一个元素（含子树），缩进规则与 ET.indent(space="  ") 一致：
/// 子元素缩进一级；最后一个子元素之后回退到父级缩进。
/// 本函数写入"前导缩进 + 元素本体"；顶层调用后由调用方补结尾换行。
pub fn write_el(out: &mut String, el: &XmlEl, depth: usize) {
    out.push_str(ind(depth));
    write_el_body(out, el, depth);
}

fn write_el_body(out: &mut String, el: &XmlEl, depth: usize) {
    out.push('<');
    out.push_str(&escape_text(&el.tag));
    for (k, v) in &el.attrs {
        out.push(' ');
        out.push_str(&escape_text(k));
        out.push_str("=\"");
        out.push_str(&escape_attr(v));
        out.push('"');
    }
    if el.children.is_empty() {
        out.push_str(" />");
        return;
    }
    out.push('>');
    let n = el.children.len();
    for (i, c) in el.children.iter().enumerate() {
        out.push('\n');
        out.push_str(ind(if i + 1 < n { depth + 1 } else { depth }));
        write_el_body(out, c, depth + 1);
    }
    out.push_str("</");
    out.push_str(&escape_text(&el.tag));
    out.push('>');
}
