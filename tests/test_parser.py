import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "app"))

import main


def flat_texts(node):
    out = [node["text"]]
    for c in node["children"]:
        out.extend(flat_texts(c))
    return out


def find_text(node, text):
    if node["text"] == text:
        return node
    for c in node["children"]:
        r = find_text(c, text)
        if r:
            return r
    return None


def find_prefix(node, prefix):
    if node["text"].startswith(prefix):
        return node
    for c in node["children"]:
        r = find_prefix(c, prefix)
        if r:
            return r
    return None


results = {}
root_dir = Path(__file__).resolve().parent.parent
samples = root_dir / "samples"

doc = main.load_map_file(str(samples / "sample.mm"))
results["load_sample_ok"] = doc["ok"]
if doc["ok"]:
    root = doc["root"]
    results["root_text"] = root["text"] == "产品规划"
    results["root_bold"] = root["bold"] is True
    results["root_bg"] = root["bg"] == "#2F6FED"
    results["node_count"] = len(flat_texts(root))
    shichang = find_text(root, "市场调研")
    results["has_shichang"] = shichang is not None and len(shichang["children"]) == 2
    yonghu = find_text(root, "用户访谈")
    results["folded_parsed"] = yonghu is not None and yonghu["collapsed"] is True
    fabu = find_text(root, "发布 <v1.0>")
    results["richcontent_parsed"] = fabu is not None
    gongce = find_text(root, "内测 & 公测")
    results["attr_escape_parsed"] = gongce is not None
    gonngneng = find_text(root, "功能设计")
    results["bold_child"] = gonngneng is not None and gonngneng["bold"] is True
    jingpin = find_text(root, "竞品分析")
    results["color_parsed"] = jingpin is not None and jingpin["color"] == "#C0392B"

doc2 = main.load_map_file(str(samples / "reading.xml"))
results["load_xml_ok"] = doc2["ok"]
if doc2["ok"]:
    results["xml_format_field"] = doc2["format"] == "xml"
    results["xml_root_text"] = doc2["root"]["text"] == "读书笔记"
    results["xml_node_count"] = len(flat_texts(doc2["root"]))

doc3 = main.load_map_file(str(samples / "special.mm"))
results["load_special_ok"] = doc3["ok"]
if doc3["ok"]:
    t1 = find_text(doc3["root"], '引号 "single" 和 \'apos\'')
    t2 = find_text(doc3["root"], "公式 a<b && b>c")
    t3 = find_text(doc3["root"], "中文「标点」·→ ★")
    results["special_chars_parsed"] = t1 is not None and t2 is not None and t3 is not None

if doc["ok"]:
    with tempfile.TemporaryDirectory() as td:
        out_mm = Path(td) / "roundtrip.mm"
        res = main.save_map_file(str(out_mm), doc["root"])
        results["save_ok"] = res["ok"]
        re = main.load_map_file(str(out_mm))
        results["roundtrip_texts"] = re["ok"] and flat_texts(re["root"]) == flat_texts(doc["root"])
        ra = main.load_map_file(str(out_mm))
        ra_root = ra["root"]
        ra_yonghu = find_text(ra_root, "用户访谈")
        results["roundtrip_folded"] = ra_yonghu is not None and ra_yonghu["collapsed"] is True
        ra_jingpin = find_text(ra_root, "竞品分析")
        results["roundtrip_color"] = ra_jingpin is not None and ra_jingpin["color"] == "#C0392B"
        ra_gonngneng = find_text(ra_root, "功能设计")
        results["roundtrip_bold"] = ra_gonngneng is not None and ra_gonngneng["bold"] is True

        out_xml = Path(td) / "roundtrip.xml"
        res2 = main.save_map_file(str(out_xml), doc2["root"])
        re2 = main.load_map_file(str(out_xml))
        results["save_xml_ok"] = res2["ok"] and re2["ok"]
        results["xml_roundtrip_texts"] = flat_texts(re2["root"]) == flat_texts(doc2["root"])

        data = out_mm.read_bytes()
        results["utf8_no_bom"] = not data.startswith(b"\xef\xbb\xbf")
        results["has_xml_decl"] = data.startswith(b"<?xml")
        results["has_map_element"] = b"<map" in data

bad = main.load_map_file(str(samples / "sample.mm") + ".nonexistent")
results["load_missing_error"] = bad["ok"] is False and bool(bad.get("error"))

results["sample_layout_default"] = doc.get("layout", "missing") == ""

with tempfile.TemporaryDirectory() as td:
    themed_root = {
        "text": "主题测试",
        "children": [
            {"text": "带附件", "attach": [{"name": "说明.pdf", "rel": "说明.pdf"}]},
        ],
    }
    out2 = Path(td) / "themed.mm"
    r1 = main.save_map_file(str(out2), {"root": themed_root, "layout": "org-down", "theme": "dark"})
    results["save_meta_ok"] = r1["ok"]
    lt = main.load_map_file(str(out2))
    results["layout_roundtrip"] = lt["ok"] and lt["layout"] == "org-down"
    results["theme_roundtrip"] = lt["ok"] and lt["theme"] == "dark"
    at = lt["root"]["children"][0]["attach"]
    results["attach_roundtrip"] = len(at) == 1 and at[0]["name"] == "说明.pdf" and at[0]["rel"] == "说明.pdf"
    raw = out2.read_bytes()
    results["map_has_layout_attr"] = b'layout="org-down"' in raw and b'theme="dark"' in raw

    out3 = Path(td) / "bad_layout.mm"
    r2 = main.save_map_file(str(out3), {"root": themed_root, "layout": "hacked;bad", "theme": "x" * 40})
    lt3 = main.load_map_file(str(out3))
    results["bad_layout_rejected"] = lt3["ok"] and lt3["layout"] == ""
    results["theme_truncated"] = len(lt3["theme"]) <= 24

    out4 = Path(td) / "legacy.mm"
    out4.write_bytes('<?xml version="1.0" encoding="UTF-8"?><map version="1.0.1"><node TEXT="旧文件"><node TEXT="子"/></node></map>'.encode("utf-8"))
    lt4 = main.load_map_file(str(out4))
    results["legacy_defaults"] = lt4["ok"] and lt4["layout"] == "" and lt4["theme"] == "" and lt4["root"]["children"][0]["attach"] == []
    results["legacy_no_size"] = lt4["ok"] and lt4["root"]["w"] == 0 and lt4["root"]["h"] == 0

    # WIDTH / HEIGHT 往返
    sized_root = {"text": "尺寸节点", "w": 180, "h": 56, "children": [{"text": "默认尺寸"}]}
    out5 = Path(td) / "sized.mm"
    r5 = main.save_map_file(str(out5), {"root": sized_root})
    raw5 = out5.read_bytes()
    results["size_attrs_written"] = b'WIDTH="180"' in raw5 and b'HEIGHT="56"' in raw5
    lt5 = main.load_map_file(str(out5))
    results["size_roundtrip"] = lt5["ok"] and lt5["root"]["w"] == 180 and lt5["root"]["h"] == 56
    results["size_child_default"] = lt5["ok"] and lt5["root"]["children"][0]["w"] == 0 and lt5["root"]["children"][0]["h"] == 0
    bad_sz = Path(td) / "badsz.mm"
    bad_sz.write_bytes('<?xml version="1.0"?><map><node TEXT="x" WIDTH="abc" HEIGHT="-5"/></map>'.encode("utf-8"))
    lb = main.load_map_file(str(bad_sz))
    results["size_bad_values"] = lb["ok"] and lb["root"]["w"] == 0 and lb["root"]["h"] == 0

# ── .xmind 导入 ──────────────────────────────────────────────
import io
import zipfile

with tempfile.TemporaryDirectory() as td:
    # 新版 XMind（content.json）
    cj = [
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
    ]
    x1 = Path(td) / "new.xmind"
    with zipfile.ZipFile(x1, "w") as z:
        z.writestr("content.json", json.dumps(cj, ensure_ascii=False))
        z.writestr("metadata.json", "{}")
        z.writestr("Thumbnails/thumbnail.png", b"png")
    dx = main.load_map_file(str(x1))
    results["xmind_json_ok"] = dx["ok"] and dx["format"] == "xmind"
    if dx["ok"]:
        xr = dx["root"]
        results["xmind_json_root"] = xr["text"] == "中心主题"
        results["xmind_json_children"] = len(xr["children"]) == 3
        zt = find_prefix(xr, "➊ 主任务")
        results["xmind_json_marker"] = zt is not None
        results["xmind_json_label"] = zt is not None and "[标签] 重要" in zt["text"]
        results["xmind_json_notes"] = zt is not None and "[备注] 这是备注" in zt["text"]
        results["xmind_json_grandchild"] = find_text(xr, "子任务 A") is not None
        results["xmind_json_detached"] = find_text(xr, "游离点") is not None and find_text(xr, "根下游离") is not None

    # 旧版 XMind 8（content.xml）
    cx = """<?xml version="1.0" encoding="UTF-8"?>
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
</sheet>"""
    x2 = Path(td) / "old.xmind"
    with zipfile.ZipFile(x2, "w") as z:
        z.writestr("content.xml", cx)
        z.writestr("META-INF/manifest.xml", "<manifest/>")
    dx2 = main.load_map_file(str(x2))
    results["xmind_xml_ok"] = dx2["ok"] and dx2["format"] == "xmind"
    if dx2["ok"]:
        xr2 = dx2["root"]
        results["xmind_xml_root"] = xr2["text"] == "旧版中心"
        fz = find_prefix(xr2, "➋⭐ 分支一")
        results["xmind_xml_notes"] = fz is not None and "[备注] 旧版备注" in fz["text"]
        results["xmind_xml_label"] = fz is not None and "[标签] 标签X" in fz["text"]
        results["xmind_xml_markers"] = fz is not None
        results["xmind_xml_grandchild"] = find_text(xr2, "孙节点") is not None
        results["xmind_xml_two_branches"] = len(xr2["children"]) == 2

    # 导入后可另存为 .mm 并往返
    if dx["ok"]:
        out_conv = Path(td) / "converted.mm"
        rc = main.save_map_file(str(out_conv), dx["root"])
        recon = main.load_map_file(str(out_conv))
        results["xmind_convert_mm"] = rc["ok"] and recon["ok"] and find_text(recon["root"], "子任务 A") is not None

    # 损坏 / 非 xmind / 缺 content
    bad1 = Path(td) / "corrupt.xmind"
    bad1.write_bytes(b"PK\x03\x04 this is not really a zip")
    d1 = main.load_map_file(str(bad1))
    results["xmind_corrupt_error"] = d1["ok"] is False and "损坏" in (d1.get("error") or "")

    bad2 = Path(td) / "notzip.xmind"
    bad2.write_bytes(b"hello world, definitely not a zip")
    d2 = main.load_map_file(str(bad2))
    results["xmind_notzip_error"] = d2["ok"] is False and bool(d2.get("error"))

    bad3 = Path(td) / "empty.xmind"
    with zipfile.ZipFile(bad3, "w") as z:
        z.writestr("readme.txt", "nothing here")
    d3 = main.load_map_file(str(bad3))
    results["xmind_nocontent_error"] = d3["ok"] is False and "content" in (d3.get("error") or "")

    bad4 = Path(td) / "badjson.xmind"
    with zipfile.ZipFile(bad4, "w") as z:
        z.writestr("content.json", "{not valid json")
    d4 = main.load_map_file(str(bad4))
    results["xmind_badjson_error"] = d4["ok"] is False and "content.json" in (d4.get("error") or "")

    # 保存保护：不允许写回 .xmind
    if dx["ok"]:
        guard = Path(td) / "guard.xmind"
        rg = main.save_map_file(str(guard), dx["root"])
        results["xmind_save_guard"] = rg["ok"] is False and ".mm" in (rg.get("error") or "")

    # ── v1.6 格式字段往返 ──────────────────────────────────
    fmt_root = main._base_node("格式根")
    kid = main._base_node("公式")
    kid["fs"] = 20
    kid["it"] = True
    kid["ul"] = True
    kid["latex"] = "\\frac{a}{b}"
    kid["img"] = "粘贴图片.png"
    kid2 = main._base_node("默认字号")
    kid2["fs"] = 12
    fmt_root["children"] = [kid, kid2]
    fmt_path = Path(td) / "fmt.mm"
    rf = main.save_map_file(str(fmt_path), fmt_root)
    results["fmt_save_ok"] = rf["ok"]
    df = main.load_map_file(str(fmt_path))
    results["fmt_load_ok"] = df["ok"]
    if df["ok"]:
        fk = find_text(df["root"], "公式")
        results["fmt_fs_roundtrip"] = fk is not None and fk["fs"] == 20
        results["fmt_it_roundtrip"] = fk is not None and fk["it"] is True
        results["fmt_ul_roundtrip"] = fk is not None and fk["ul"] is True
        results["fmt_latex_roundtrip"] = fk is not None and fk["latex"] == "\\frac{a}{b}"
        results["fmt_img_roundtrip"] = fk is not None and fk["img"] == "粘贴图片.png"
        fk2 = find_text(df["root"], "默认字号")
        results["fmt_size12_ignored"] = fk2 is not None and fk2["fs"] == 0
        raw = fmt_path.read_text(encoding="utf-8")
        results["fmt_no_size12_attr"] = 'SIZE="12"' not in raw
        results["fmt_has_size20"] = 'SIZE="20"' in raw
        results["fmt_has_italic"] = 'ITALIC="true"' in raw
        results["fmt_has_underline"] = 'UNDERLINE="true"' in raw
        results["fmt_has_latex_attr"] = 'LATEX=' in raw
        results["fmt_has_image_attr"] = 'IMAGE=' in raw
    # add_image_file
    img_map = Path(td) / "imgmap.mm"
    main.save_map_file(str(img_map), main._base_node("中心"))
    ri = main.add_image_file(str(img_map), "aGVsbG8=", "png")
    results["img_add_ok"] = ri["ok"] and ri["name"] == "粘贴图片.png" and ri["data"] == "aGVsbG8="
    results["img_no_assets_dir"] = not (img_map.parent / "imgmap.assets").exists()
    ri3 = main.add_image_file(str(img_map), "", "png")
    results["img_empty_error"] = ri3["ok"] is False
    ri4 = main.add_image_file(str(Path(td) / "nofile.mm"), "aGVsbG8=", "png")
    results["img_no_map_error"] = ri4["ok"] is False and "保存" in (ri4.get("error") or "")

    # ── v1.7 PNG 导出与图片数据读取 ────────────────────────
    png_map = Path(td) / "pngmap.mm"
    main.save_map_file(str(png_map), main._base_node("中心"))
    png1x1_b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
    rp = main.save_png_file(str(png_map), png1x1_b64)
    results["png_save_ok"] = rp["ok"] and (Path(td) / "pngmap.png").read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    rp2 = main.save_png_file(str(png_map), "###")
    results["png_save_bad"] = rp2["ok"] is False
    rp3 = main.save_png_file(str(Path(td) / "nofile.mm"), "aGVsbG8=")
    results["png_save_no_map"] = rp3["ok"] is False and "保存" in (rp3.get("error") or "")
    # read_image_data 面向旧版 .assets 图片（手动构造 sidecar）
    img_sc = img_map.parent / "imgmap.assets"
    img_sc.mkdir(exist_ok=True)
    (img_sc / "粘贴图片.png").write_bytes(b"hello")
    ri5 = main.read_image_data(str(img_map), "粘贴图片.png")
    results["img_read_ok"] = ri5["ok"] and ri5["mime"] == "image/png" and ri5["data"] == "aGVsbG8="
    ri6 = main.read_image_data(str(img_map), "../escape.png")
    results["img_read_traversal"] = ri6["ok"] is False
    ri7 = main.read_image_data(str(img_map), "nope.png")
    results["img_read_missing"] = ri7["ok"] is False

    # ── v1.8 附件内嵌与 IMGDATA ────────────────────────────
    emb_root = main._base_node("内嵌根")
    emb_root["attach"] = [{"name": "打包.rar", "data": "aGVsbG8tcGFja2FnZQ=="}]
    emb_root["img"] = "粘贴图片.png"
    emb_root["imgdata"] = "aGVsbG8tcG5n"
    emb_path = Path(td) / "emb.mm"
    results["emb_save_ok"] = main.save_map_file(str(emb_path), emb_root)["ok"]
    de = main.load_map_file(str(emb_path))
    results["emb_load_ok"] = de["ok"]
    if de["ok"]:
        results["emb_attach_data"] = de["root"]["attach"][0].get("data") == "aGVsbG8tcGFja2FnZQ=="
        results["emb_attach_name"] = de["root"]["attach"][0].get("name") == "打包.rar"
        results["emb_imgdata"] = de["root"]["imgdata"] == "aGVsbG8tcG5n"
        results["emb_img_name"] = de["root"]["img"] == "粘贴图片.png"
    results["emb_no_assets_dir"] = not (Path(td) / "emb.assets").exists()
    # 旧格式（rel + .assets）仍可解析与提取
    old_root = main._base_node("旧附件根")
    old_root["attach"] = [{"name": "旧附件.txt", "rel": "旧附件.txt"}]
    old_path = Path(td) / "oldatt.mm"
    main.save_map_file(str(old_path), old_root)
    sc = old_path.parent / "oldatt.assets"
    sc.mkdir(exist_ok=True)
    (sc / "旧附件.txt").write_text("old style", encoding="utf-8")
    do = main.load_map_file(str(old_path))
    results["old_attach_parsed"] = do["ok"] and do["root"]["attach"][0].get("rel") == "旧附件.txt"
    ex_old = main.extract_attachment_file(str(old_path), {"name": "旧附件.txt", "rel": "旧附件.txt"})
    results["old_extract_ok"] = ex_old["ok"] and Path(ex_old["path"]).read_text(encoding="utf-8") == "old style"
    ex_str = main.extract_attachment_file(str(old_path), "旧附件.txt")
    results["old_extract_str_arg"] = ex_str["ok"]
    ex_new = main.extract_attachment_file(str(emb_path), {"name": "打包.rar", "data": "aGVsbG8tcGFja2FnZQ=="})
    results["emb_extract_ok"] = ex_new["ok"] and Path(ex_new["path"]).read_bytes() == b"hello-package"
    ex_missing = main.extract_attachment_file(str(old_path), {"name": "x.txt", "rel": "nope.txt"})
    results["old_extract_missing"] = ex_missing["ok"] is False
    ex_trav = main.extract_attachment_file(str(old_path), {"name": "../evil.txt", "data": "aGVsbG8="})
    results["extract_name_sanitized"] = ex_trav["ok"] and Path(ex_trav["path"]).name.startswith("evil") \
        and ".." not in Path(ex_trav["path"]).name and "/" not in Path(ex_trav["path"]).name \
        and "\\" not in Path(ex_trav["path"]).name

    # ── v1.9 剪贴板文件附件：数据插入 + 另存为 ──────────────
    rd = main.add_attachment_data_file(str(emb_path), "测试.zip", "UEsDBBQAAAgA")
    results["attdata_ok"] = rd["ok"] and rd["name"] == "测试.zip" and rd["data"] == "UEsDBBQAAAgA"
    rd2 = main.add_attachment_data_file(str(emb_path), "../evil.zip", "UEsDBBQAAAgA")
    results["attdata_name_sanitized"] = rd2["ok"] and rd2["name"] == "evil.zip"
    rd3 = main.add_attachment_data_file(str(emb_path), "x.zip", "")
    results["attdata_empty"] = rd3["ok"] is False
    rd4 = main.add_attachment_data_file(str(Path(td) / "nofile.mm"), "x.zip", "UEsDBBQAAAgA")
    results["attdata_no_map"] = rd4["ok"] is False and "保存" in (rd4.get("error") or "")
    dest = Path(td) / "out" / "测试.zip"
    rs = main.save_attachment_file(str(emb_path), {"name": "测试.zip", "data": "UEsDBBQAAAgA"}, str(dest))
    results["att_saveas_ok"] = rs["ok"] and dest.read_bytes() == b"PK\x03\x04\x14\x00\x00\x08\x00"
    rs2 = main.save_attachment_file(str(emb_path), {"name": "测试.zip", "data": "UEsDBBQAAAgA"}, str(dest))
    results["att_saveas_exists"] = rs2["ok"] is False and "已存在" in (rs2.get("error") or "")
    rs3 = main.save_attachment_file(str(old_path), {"name": "旧附件.txt", "rel": "旧附件.txt"}, str(Path(td) / "out2" / "旧附件.txt"))
    results["att_saveas_old_rel"] = rs3["ok"] and (Path(td) / "out2" / "旧附件.txt").read_text(encoding="utf-8") == "old style"
    rs4 = main.save_attachment_file(str(old_path), {"name": "x", "rel": "nope.txt"}, str(Path(td) / "out3" / "x.txt"))
    results["att_saveas_missing"] = rs4["ok"] is False

ok = all(v is True or isinstance(v, int) for v in results.values())
expected_count = 11
results["sample_node_count_is_11"] = results.get("node_count") == expected_count
ok = ok and results["sample_node_count_is_11"]

results["ok"] = ok

out = Path(__file__).resolve().parent / "parser-result.json"
out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(results, ensure_ascii=False))
sys.exit(0 if ok else 1)
