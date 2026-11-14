//! 解析器行为测试：逐条对齐原项目 tests/test_parser.py 的断言契约。

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rustmindplot::files::{
    add_attachment_data_file, add_image_file, extract_attachment_file, load_map_file,
    read_image_data, save_attachment_file, save_map_file, save_png_file,
};
use rustmindplot::mm::{parse_map_bytes, serialize_mm, MmNode};
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use zip::write::SimpleFileOptions;
use zip::ZipWriter;

fn samples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("samples")
}

fn tmp_dir(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("RustMindPlot_test_{}", name));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn flat_texts(node: &MmNode, out: &mut Vec<String>) {
    out.push(node.text.clone());
    for c in &node.children {
        flat_texts(c, out);
    }
}

fn texts(node: &MmNode) -> Vec<String> {
    let mut v = Vec::new();
    flat_texts(node, &mut v);
    v
}

fn find_text<'a>(node: &'a MmNode, text: &str) -> Option<&'a MmNode> {
    if node.text == text {
        return Some(node);
    }
    node.children.iter().find_map(|c| find_text(c, text))
}

fn find_prefix<'a>(node: &'a MmNode, prefix: &str) -> Option<&'a MmNode> {
    if node.text.starts_with(prefix) {
        return Some(node);
    }
    node.children.iter().find_map(|c| find_prefix(c, prefix))
}

fn make_zip(path: &Path, files: &[(&str, Vec<u8>)]) {
    let cursor = std::io::Cursor::new(Vec::new());
    let mut zw = ZipWriter::new(cursor);
    for (name, data) in files {
        zw.start_file(*name, SimpleFileOptions::default()).unwrap();
        zw.write_all(data).unwrap();
    }
    let cur = zw.finish().unwrap();
    std::fs::write(path, cur.get_ref()).unwrap();
}

// ── sample.mm ────────────────────────────────────────────────

#[test]
fn load_sample() {
    let doc = load_map_file(samples_dir().join("sample.mm").to_str().unwrap()).unwrap();
    let root = &doc.root;
    assert_eq!(root.text, "产品规划");
    assert!(root.bold);
    assert_eq!(root.bg, "#2F6FED");
    assert_eq!(texts(root).len(), 11);
    let shichang = find_text(root, "市场调研").unwrap();
    assert_eq!(shichang.children.len(), 2);
    let yonghu = find_text(root, "用户访谈").unwrap();
    assert!(yonghu.collapsed);
    assert!(find_text(root, "发布 <v1.0>").is_some());
    assert!(find_text(root, "内测 & 公测").is_some());
    assert!(find_text(root, "功能设计").unwrap().bold);
    assert_eq!(find_text(root, "竞品分析").unwrap().color, "#C0392B");
    assert_eq!(doc.layout, "");
}

#[test]
fn load_reading_xml() {
    let doc = load_map_file(samples_dir().join("reading.xml").to_str().unwrap()).unwrap();
    assert_eq!(doc.format, "xml");
    assert_eq!(doc.root.text, "读书笔记");
    assert!(!texts(&doc.root).is_empty());
}

#[test]
fn load_special_chars() {
    let doc = load_map_file(samples_dir().join("special.mm").to_str().unwrap()).unwrap();
    assert!(find_text(&doc.root, "引号 \"single\" 和 'apos'").is_some());
    assert!(find_text(&doc.root, "公式 a<b && b>c").is_some());
    assert!(find_text(&doc.root, "中文「标点」·→ ★").is_some());
}

#[test]
fn roundtrip_mm() {
    let doc = load_map_file(samples_dir().join("sample.mm").to_str().unwrap()).unwrap();
    let td = tmp_dir("roundtrip");
    let out = td.join("roundtrip.mm");
    let res = save_map_file(out.to_str().unwrap(), &json!(doc.root));
    assert_eq!(res["ok"], json!(true));
    let re = load_map_file(out.to_str().unwrap()).unwrap();
    assert_eq!(texts(&re.root), texts(&doc.root));
    assert!(find_text(&re.root, "用户访谈").unwrap().collapsed);
    assert_eq!(find_text(&re.root, "竞品分析").unwrap().color, "#C0392B");
    assert!(find_text(&re.root, "功能设计").unwrap().bold);

    let data = std::fs::read(&out).unwrap();
    assert!(!data.starts_with(b"\xef\xbb\xbf"));
    assert!(data.starts_with(b"<?xml"));
    assert!(windows_contains(&data, b"<map"));
}

fn windows_contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[test]
fn roundtrip_xml() {
    let doc = load_map_file(samples_dir().join("reading.xml").to_str().unwrap()).unwrap();
    let td = tmp_dir("roundtrip_xml");
    let out = td.join("roundtrip.xml");
    let res = save_map_file(out.to_str().unwrap(), &json!(doc.root));
    assert_eq!(res["ok"], json!(true));
    let re = load_map_file(out.to_str().unwrap()).unwrap();
    assert_eq!(texts(&re.root), texts(&doc.root));
}

#[test]
fn load_missing_error() {
    let p = samples_dir().join("sample.mm.nonexistent");
    assert!(load_map_file(p.to_str().unwrap()).is_err());
}

#[test]
fn layout_theme_meta() {
    let td = tmp_dir("themed");
    let themed_root = json!({
        "text": "主题测试",
        "children": [
            {"text": "带附件", "attach": [{"name": "说明.pdf", "rel": "说明.pdf"}]},
        ],
    });
    let out = td.join("themed.mm");
    let r1 = save_map_file(
        out.to_str().unwrap(),
        &json!({"root": themed_root, "layout": "org-down", "theme": "dark"}),
    );
    assert_eq!(r1["ok"], json!(true));
    let lt = load_map_file(out.to_str().unwrap()).unwrap();
    assert_eq!(lt.layout, "org-down");
    assert_eq!(lt.theme, "dark");
    let at = &lt.root.children[0].attach;
    assert_eq!(at.len(), 1);
    assert_eq!(at[0].name, "说明.pdf");
    assert_eq!(at[0].rel, "说明.pdf");
    let raw = std::fs::read(&out).unwrap();
    assert!(windows_contains(&raw, b"layout=\"org-down\""));
    assert!(windows_contains(&raw, b"theme=\"dark\""));

    let out3 = td.join("bad_layout.mm");
    let bad_root = json!({
        "text": "主题测试",
        "children": [
            {"text": "带附件", "attach": [{"name": "说明.pdf", "rel": "说明.pdf"}]},
        ],
    });
    let _r2 = save_map_file(
        out3.to_str().unwrap(),
        &json!({"root": bad_root, "layout": "hacked;bad", "theme": "x".repeat(40)}),
    );
    let lt3 = load_map_file(out3.to_str().unwrap()).unwrap();
    assert_eq!(lt3.layout, "");
    assert!(lt3.theme.chars().count() <= 24);
}

#[test]
fn legacy_defaults() {
    let td = tmp_dir("legacy");
    let out = td.join("legacy.mm");
    std::fs::write(
        &out,
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><map version=\"1.0.1\"><node TEXT=\"旧文件\"><node TEXT=\"子\"/></node></map>".as_bytes(),
    )
    .unwrap();
    let lt = load_map_file(out.to_str().unwrap()).unwrap();
    assert_eq!(lt.layout, "");
    assert_eq!(lt.theme, "");
    assert!(lt.root.children[0].attach.is_empty());
    assert_eq!(lt.root.w, 0.0);
    assert_eq!(lt.root.h, 0.0);
}

#[test]
fn size_attrs() {
    let td = tmp_dir("sized");
    let sized_root = json!({
        "text": "尺寸节点", "w": 180, "h": 56,
        "children": [{"text": "默认尺寸"}],
    });
    let out = td.join("sized.mm");
    let r5 = save_map_file(out.to_str().unwrap(), &json!({"root": sized_root}));
    assert_eq!(r5["ok"], json!(true));
    let raw = std::fs::read(&out).unwrap();
    assert!(windows_contains(&raw, b"WIDTH=\"180\""));
    assert!(windows_contains(&raw, b"HEIGHT=\"56\""));
    let lt = load_map_file(out.to_str().unwrap()).unwrap();
    assert_eq!(lt.root.w, 180.0);
    assert_eq!(lt.root.h, 56.0);
    assert_eq!(lt.root.children[0].w, 0.0);
    assert_eq!(lt.root.children[0].h, 0.0);

    let bad = td.join("badsz.mm");
    std::fs::write(
        &bad,
        "<?xml version=\"1.0\"?><map><node TEXT=\"x\" WIDTH=\"abc\" HEIGHT=\"-5\"/></map>".as_bytes(),
    )
    .unwrap();
    let lb = load_map_file(bad.to_str().unwrap()).unwrap();
    assert_eq!(lb.root.w, 0.0);
    assert_eq!(lb.root.h, 0.0);
}

// ── .xmind 导入 ──────────────────────────────────────────────

#[test]
fn xmind_json() {
    let td = tmp_dir("xmind_json");
    let cj = json!([
        {
            "id": "s1", "class": "sheet", "title": "Sheet 1",
            "rootTopic": {
                "id": "t1", "class": "topic", "title": "中心主题",
                "children": {
                    "attached": [
                        {
                            "id": "t2", "title": "主任务",
                            "markers": {"markerId": "priority-1"},
                            "labels": ["重要"],
                            "notes": {"plain": {"content": "这是备注"}},
                            "children": {"attached": [{"id": "t3", "title": "子任务 A"}]},
                        },
                        {"id": "t4", "title": "浮动主题", "children": {"detached": [{"id": "t5", "title": "游离点"}]}},
                    ],
                    "detached": [{"id": "t6", "title": "根下游离"}],
                },
            },
        }
    ]);
    let x1 = td.join("new.xmind");
    make_zip(
        &x1,
        &[
            ("content.json", serde_json::to_vec(&cj).unwrap()),
            ("metadata.json", b"{}".to_vec()),
            ("Thumbnails/thumbnail.png", b"png".to_vec()),
        ],
    );
    let dx = load_map_file(x1.to_str().unwrap()).unwrap();
    assert_eq!(dx.format, "xmind");
    let xr = &dx.root;
    assert_eq!(xr.text, "中心主题");
    assert_eq!(xr.children.len(), 3);
    let zt = find_prefix(xr, "➊ 主任务").unwrap();
    assert!(zt.text.contains("[标签] 重要"));
    assert!(zt.text.contains("[备注] 这是备注"));
    assert!(find_text(xr, "子任务 A").is_some());
    assert!(find_text(xr, "游离点").is_some());
    assert!(find_text(xr, "根下游离").is_some());

    // 导入后可另存为 .mm 并往返
    let out_conv = td.join("converted.mm");
    let rc = save_map_file(out_conv.to_str().unwrap(), &json!(dx.root));
    assert_eq!(rc["ok"], json!(true));
    let recon = load_map_file(out_conv.to_str().unwrap()).unwrap();
    assert!(find_text(&recon.root, "子任务 A").is_some());

    // 保存保护：不允许写回 .xmind
    let guard = td.join("guard.xmind");
    let rg = save_map_file(guard.to_str().unwrap(), &json!(dx.root));
    assert_eq!(rg["ok"], json!(false));
    assert!(rg["error"].as_str().unwrap().contains(".mm"));
}

#[test]
fn xmind_xml() {
    let td = tmp_dir("xmind_xml");
    let cx = r#"<?xml version="1.0" encoding="UTF-8"?>
<sheet id="s" timestamp="1">
  <topic id="r" timestamp="2" structure-class="org.xmind.ui.map.unbalanced">
    <title>旧版中心</title>
    <children>
      <topics type="attached" id="c1">
        <topic id="a"><title>分支一</title>
          <notes><plain>旧版备注</plain></notes>
          <labels><label>标签X</label></labels>
          <marker-refs><marker-ref marker-id="priority-2"/><marker-ref marker-id="star-red"/></marker-refs>
          <children><topics type="attached"><topic id="a1"><title>孙节点</title></topic></topics></children>
        </topic>
        <topic id="b"><title>分支二</title></topic>
      </topics>
    </children>
  </topic>
</sheet>"#;
    let x2 = td.join("old.xmind");
    make_zip(
        &x2,
        &[
            ("content.xml", cx.as_bytes().to_vec()),
            ("META-INF/manifest.xml", b"<manifest/>".to_vec()),
        ],
    );
    let dx = load_map_file(x2.to_str().unwrap()).unwrap();
    assert_eq!(dx.format, "xmind");
    assert_eq!(dx.root.text, "旧版中心");
    let fz = find_prefix(&dx.root, "➋⭐ 分支一").unwrap();
    assert!(fz.text.contains("[备注] 旧版备注"));
    assert!(fz.text.contains("[标签] 标签X"));
    assert!(find_text(&dx.root, "孙节点").is_some());
    assert_eq!(dx.root.children.len(), 2);
}

#[test]
fn xmind_errors() {
    let td = tmp_dir("xmind_err");
    let bad1 = td.join("corrupt.xmind");
    std::fs::write(&bad1, b"PK\x03\x04 this is not really a zip").unwrap();
    let e1 = load_map_file(bad1.to_str().unwrap()).unwrap_err();
    assert!(e1.contains("损坏"));

    let bad2 = td.join("notzip.xmind");
    std::fs::write(&bad2, b"hello world, definitely not a zip").unwrap();
    assert!(load_map_file(bad2.to_str().unwrap()).is_err());

    let bad3 = td.join("empty.xmind");
    make_zip(&bad3, &[("readme.txt", b"nothing here".to_vec())]);
    let e3 = load_map_file(bad3.to_str().unwrap()).unwrap_err();
    assert!(e3.contains("content"));

    let bad4 = td.join("badjson.xmind");
    make_zip(&bad4, &[("content.json", b"{not valid json".to_vec())]);
    let e4 = load_map_file(bad4.to_str().unwrap()).unwrap_err();
    assert!(e4.contains("content.json"));
}

// ── 格式字段往返 ─────────────────────────────────────────────

#[test]
fn format_fields_roundtrip() {
    let td = tmp_dir("fmt");
    let fmt_root = json!({
        "text": "格式根",
        "children": [
            {"text": "公式", "fs": 20, "it": true, "ul": true,
             "latex": "\\frac{a}{b}", "img": "粘贴图片.png"},
            {"text": "默认字号", "fs": 12},
        ],
    });
    let fmt_path = td.join("fmt.mm");
    let rf = save_map_file(fmt_path.to_str().unwrap(), &json!(fmt_root));
    assert_eq!(rf["ok"], json!(true));
    let df = load_map_file(fmt_path.to_str().unwrap()).unwrap();
    let fk = find_text(&df.root, "公式").unwrap();
    assert_eq!(fk.fs, 20.0);
    assert!(fk.it);
    assert!(fk.ul);
    assert_eq!(fk.latex, "\\frac{a}{b}");
    assert_eq!(fk.img, "粘贴图片.png");
    let fk2 = find_text(&df.root, "默认字号").unwrap();
    assert_eq!(fk2.fs, 0.0);
    let raw = String::from_utf8(std::fs::read(&fmt_path).unwrap()).unwrap();
    assert!(!raw.contains("SIZE=\"12\""));
    assert!(raw.contains("SIZE=\"20\""));
    assert!(raw.contains("ITALIC=\"true\""));
    assert!(raw.contains("UNDERLINE=\"true\""));
    assert!(raw.contains("LATEX="));
    assert!(raw.contains("IMAGE="));
}

#[test]
fn image_add_and_read() {
    let td = tmp_dir("img");
    let img_map = td.join("imgmap.mm");
    save_map_file(img_map.to_str().unwrap(), &json!({"text": "中心"}));
    let ri = add_image_file(img_map.to_str().unwrap(), "aGVsbG8=", "png");
    assert_eq!(ri["ok"], json!(true));
    assert_eq!(ri["name"], json!("粘贴图片.png"));
    assert_eq!(ri["data"], json!("aGVsbG8="));
    assert!(!td.join("imgmap.assets").exists());
    let ri3 = add_image_file(img_map.to_str().unwrap(), "", "png");
    assert_eq!(ri3["ok"], json!(false));
    let ri4 = add_image_file(td.join("nofile.mm").to_str().unwrap(), "aGVsbG8=", "png");
    assert_eq!(ri4["ok"], json!(false));
    assert!(ri4["error"].as_str().unwrap().contains("保存"));

    // read_image_data 面向旧版 .assets 图片
    let sc = td.join("imgmap.assets");
    std::fs::create_dir_all(&sc).unwrap();
    std::fs::write(sc.join("粘贴图片.png"), b"hello").unwrap();
    let ri5 = read_image_data(img_map.to_str().unwrap(), "粘贴图片.png");
    assert_eq!(ri5["ok"], json!(true));
    assert_eq!(ri5["mime"], json!("image/png"));
    assert_eq!(ri5["data"], json!("aGVsbG8="));
    let ri6 = read_image_data(img_map.to_str().unwrap(), "../escape.png");
    assert_eq!(ri6["ok"], json!(false));
    let ri7 = read_image_data(img_map.to_str().unwrap(), "nope.png");
    assert_eq!(ri7["ok"], json!(false));
}

#[test]
fn png_export() {
    let td = tmp_dir("png");
    let png_map = td.join("pngmap.mm");
    save_map_file(png_map.to_str().unwrap(), &json!({"text": "中心"}));
    let png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let rp = save_png_file(png_map.to_str().unwrap(), png1x1);
    assert_eq!(rp["ok"], json!(true));
    let data = std::fs::read(td.join("pngmap.png")).unwrap();
    assert!(data.starts_with(b"\x89PNG\r\n\x1a\n"));
    let rp2 = save_png_file(png_map.to_str().unwrap(), "###");
    assert_eq!(rp2["ok"], json!(false));
    let rp3 = save_png_file(td.join("nofile.mm").to_str().unwrap(), "aGVsbG8=");
    assert_eq!(rp3["ok"], json!(false));
    assert!(rp3["error"].as_str().unwrap().contains("保存"));
}

#[test]
fn attachments_embed_and_legacy() {
    let td = tmp_dir("att");
    // 内嵌附件 + IMGDATA
    let emb_root = json!({
        "text": "内嵌根",
        "attach": [{"name": "打包.rar", "data": "aGVsbG8tcGFja2FnZQ=="}],
        "img": "粘贴图片.png",
        "imgdata": "aGVsbG8tcG5n",
    });
    let emb_path = td.join("emb.mm");
    assert_eq!(
        save_map_file(emb_path.to_str().unwrap(), &json!(emb_root))["ok"],
        json!(true)
    );
    let de = load_map_file(emb_path.to_str().unwrap()).unwrap();
    assert_eq!(de.root.attach[0].data, "aGVsbG8tcGFja2FnZQ==");
    assert_eq!(de.root.attach[0].name, "打包.rar");
    assert_eq!(de.root.imgdata, "aGVsbG8tcG5n");
    assert_eq!(de.root.img, "粘贴图片.png");
    assert!(!td.join("emb.assets").exists());

    // 旧格式（rel + .assets）仍可解析与提取
    let old_root = json!({
        "text": "旧附件根",
        "attach": [{"name": "旧附件.txt", "rel": "旧附件.txt"}],
    });
    let old_path = td.join("oldatt.mm");
    save_map_file(old_path.to_str().unwrap(), &json!(old_root));
    let sc = td.join("oldatt.assets");
    std::fs::create_dir_all(&sc).unwrap();
    std::fs::write(sc.join("旧附件.txt"), "old style").unwrap();
    let doo = load_map_file(old_path.to_str().unwrap()).unwrap();
    assert_eq!(doo.root.attach[0].rel, "旧附件.txt");

    let ex_old = extract_attachment_file(
        old_path.to_str().unwrap(),
        &json!({"name": "旧附件.txt", "rel": "旧附件.txt"}),
    );
    assert_eq!(ex_old["ok"], json!(true));
    assert_eq!(
        std::fs::read(ex_old["path"].as_str().unwrap()).unwrap(),
        b"old style"
    );
    let ex_str = extract_attachment_file(old_path.to_str().unwrap(), &json!("旧附件.txt"));
    assert_eq!(ex_str["ok"], json!(true));
    let ex_new = extract_attachment_file(
        emb_path.to_str().unwrap(),
        &json!({"name": "打包.rar", "data": "aGVsbG8tcGFja2FnZQ=="}),
    );
    assert_eq!(ex_new["ok"], json!(true));
    assert_eq!(
        std::fs::read(ex_new["path"].as_str().unwrap()).unwrap(),
        b"hello-package"
    );
    let ex_missing = extract_attachment_file(
        old_path.to_str().unwrap(),
        &json!({"name": "x.txt", "rel": "nope.txt"}),
    );
    assert_eq!(ex_missing["ok"], json!(false));
    let ex_trav = extract_attachment_file(
        old_path.to_str().unwrap(),
        &json!({"name": "../evil.txt", "data": "aGVsbG8="}),
    );
    assert_eq!(ex_trav["ok"], json!(true));
    let pname = Path::new(ex_trav["path"].as_str().unwrap())
        .file_name()
        .unwrap()
        .to_string_lossy()
        .into_owned();
    assert!(pname.starts_with("evil"));
    assert!(!pname.contains("..") && !pname.contains('/') && !pname.contains('\\'));
}

#[test]
fn attachment_data_and_saveas() {
    let td = tmp_dir("attdata");
    let emb_path = td.join("emb.mm");
    let emb_root = json!({
        "text": "内嵌根",
        "attach": [{"name": "打包.rar", "data": "aGVsbG8tcGFja2FnZQ=="}],
    });
    save_map_file(emb_path.to_str().unwrap(), &json!(emb_root));

    let rd = add_attachment_data_file(emb_path.to_str().unwrap(), "测试.zip", "UEsDBBQAAAgA");
    assert_eq!(rd["ok"], json!(true));
    assert_eq!(rd["name"], json!("测试.zip"));
    assert_eq!(rd["data"], json!("UEsDBBQAAAgA"));
    let rd2 = add_attachment_data_file(emb_path.to_str().unwrap(), "../evil.zip", "UEsDBBQAAAgA");
    assert_eq!(rd2["ok"], json!(true));
    assert_eq!(rd2["name"], json!("evil.zip"));
    let rd3 = add_attachment_data_file(emb_path.to_str().unwrap(), "x.zip", "");
    assert_eq!(rd3["ok"], json!(false));
    let rd4 = add_attachment_data_file(
        td.join("nofile.mm").to_str().unwrap(),
        "x.zip",
        "UEsDBBQAAAgA",
    );
    assert_eq!(rd4["ok"], json!(false));
    assert!(rd4["error"].as_str().unwrap().contains("保存"));

    let dest = td.join("out").join("测试.zip");
    let rs = save_attachment_file(
        emb_path.to_str().unwrap(),
        &json!({"name": "测试.zip", "data": "UEsDBBQAAAgA"}),
        dest.to_str().unwrap(),
    );
    assert_eq!(rs["ok"], json!(true));
    assert_eq!(
        std::fs::read(&dest).unwrap(),
        b"PK\x03\x04\x14\x00\x00\x08\x00"
    );
    let rs2 = save_attachment_file(
        emb_path.to_str().unwrap(),
        &json!({"name": "测试.zip", "data": "UEsDBBQAAAgA"}),
        dest.to_str().unwrap(),
    );
    assert_eq!(rs2["ok"], json!(false));
    assert!(rs2["error"].as_str().unwrap().contains("已存在"));

    let old_path = td.join("oldatt.mm");
    let old_root = json!({
        "text": "旧附件根",
        "attach": [{"name": "旧附件.txt", "rel": "旧附件.txt"}],
    });
    save_map_file(old_path.to_str().unwrap(), &json!(old_root));
    let sc = td.join("oldatt.assets");
    std::fs::create_dir_all(&sc).unwrap();
    std::fs::write(sc.join("旧附件.txt"), "old style").unwrap();
    let rs3 = save_attachment_file(
        old_path.to_str().unwrap(),
        &json!({"name": "旧附件.txt", "rel": "旧附件.txt"}),
        td.join("out2").join("旧附件.txt").to_str().unwrap(),
    );
    assert_eq!(rs3["ok"], json!(true));
    assert_eq!(
        std::fs::read(td.join("out2").join("旧附件.txt")).unwrap(),
        b"old style"
    );
    let rs4 = save_attachment_file(
        old_path.to_str().unwrap(),
        &json!({"name": "x", "rel": "nope.txt"}),
        td.join("out3").join("x.txt").to_str().unwrap(),
    );
    assert_eq!(rs4["ok"], json!(false));
}

// ── 序列化字节级兼容（对齐 ET.tostring 输出）────────────────

#[test]
fn serialize_bytes_match_et() {
    let doc = load_map_file(samples_dir().join("sample.mm").to_str().unwrap()).unwrap();
    let out = serialize_mm(&doc.root, &doc.layout, &doc.theme);
    let text = String::from_utf8(out).unwrap();
    assert!(text.starts_with("<?xml version='1.0' encoding='UTF-8'?>\n"));
    assert!(text.contains("<map version=\"1.0.1\""));
    assert!(text.contains("<font BOLD=\"true\" NAME=\"SansSerif\" />"));
    assert!(text.contains("<node TEXT=\"市场调研\">"));
    assert!(text.contains("<node TEXT=\"竞品分析\" COLOR=\"#C0392B\" />"));
    assert!(text.contains("FOLDED=\"true\""));
    assert!(text.ends_with("</map>"));
    // 重新解析应等价
    let reparsed = parse_map_bytes(text.as_bytes()).unwrap();
    assert_eq!(texts(&reparsed.root), texts(&doc.root));
}

#[test]
fn attachments_encoding_roundtrip() {
    use rustmindplot::mm::{decode_attachments, encode_attachments, Attach};
    let atts = vec![
        Attach {
            name: "打包.rar".into(),
            rel: String::new(),
            data: "aGVsbG8=".into(),
        },
        Attach {
            name: "旧附件.txt".into(),
            rel: "旧附件.txt".into(),
            data: String::new(),
        },
    ];
    let enc = encode_attachments(&atts).unwrap();
    let decoded = decode_attachments(&enc);
    assert_eq!(decoded.len(), 2);
    assert_eq!(decoded[0].name, "打包.rar");
    assert_eq!(decoded[0].data, "aGVsbG8=");
    assert_eq!(decoded[1].rel, "旧附件.txt");
    // Python json.dumps(..., ensure_ascii=False) 的字节级格式
    let raw = B64.decode(enc.as_bytes()).unwrap();
    assert_eq!(
        String::from_utf8(raw).unwrap(),
        "[{\"name\": \"打包.rar\", \"data\": \"aGVsbG8=\"}, {\"name\": \"旧附件.txt\", \"rel\": \"旧附件.txt\"}]"
    );
    assert!(encode_attachments(&[]).is_none());
    assert!(decode_attachments("!!!bad!!!").is_empty());
}
