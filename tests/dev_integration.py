import base64
import json
import re as _re
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import webview

import main

RESULTS = {}
OUT = Path(__file__).resolve().parent / "integration-result.json"


def flat_texts(node):
    out = [node["text"]]
    for c in node["children"]:
        out.extend(flat_texts(c))
    return out


def check(name, cond):
    RESULTS[name] = bool(cond)


def main_test():
    api = main.Api()
    window = webview.create_window(
        "integration",
        url=str(ROOT / "app" / "web" / "index.html"),
        js_api=api,
        width=1100,
        height=760,
    )

    def worker():
        time.sleep(2.5)
        try:
            doc = main.load_map_file(str(ROOT / "samples" / "sample.mm"))
            check("py_load_mm", doc["ok"])
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc, ensure_ascii=False) + ")")
            time.sleep(1.0)

            raw = window.evaluate_js(
                "JSON.stringify({nodes: document.querySelectorAll('.mm-node').length,"
                " rootText: (document.querySelector('.mm-node.root .mm-node-text')||{}).textContent,"
                " edges: document.querySelectorAll('#edgeG path').length,"
                " texts: Array.from(document.querySelectorAll('.mm-node-text')).map(e=>e.textContent)})"
            )
            ui = json.loads(raw)
            check("ui_root_text", ui["rootText"] == "产品规划")
            check("ui_node_count", ui["nodes"] == 11)
            check("ui_edge_count", ui["edges"] == 8)
            check("ui_text_special", "发布 <v1.0>" in ui["texts"] and "内测 & 公测" in ui["texts"])

            raw2 = window.evaluate_js(
                "JSON.stringify({hidden: document.querySelectorAll('.mm-node.hidden').length,"
                " collapsed: (window.__MM__.MMModel.findNode(window.__MM__.state.root,"
                " window.__MM__.state.root.children[0].children[1].id)||{}).collapsed})"
            )
            ui2 = json.loads(raw2)
            check("ui_folded_state", ui2["collapsed"] is True and ui2["hidden"] == 2)

            doc2 = main.load_map_file(str(ROOT / "samples" / "reading.xml"))
            check("py_load_xml", doc2["ok"])
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc2, ensure_ascii=False) + ")")
            time.sleep(1.0)
            raw3 = window.evaluate_js(
                "JSON.stringify({rootText: (document.querySelector('.mm-node.root .mm-node-text')||{}).textContent,"
                " nodes: document.querySelectorAll('.mm-node').length})"
            )
            ui3 = json.loads(raw3)
            check("ui_xml_root", ui3["rootText"] == "读书笔记")
            check("ui_xml_nodes", ui3["nodes"] == 11)

            window.evaluate_js("window.__MM__.setLayout('timeline')")
            window.evaluate_js("window.__MM__.setTheme('dark')")
            time.sleep(0.5)
            snap = window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())")
            js_root = json.loads(snap)
            tmp = Path(__file__).resolve().parent / "_tmp_save.mm"
            res = main.save_map_file(str(tmp), {
                "root": js_root,
                "layout": window.evaluate_js("window.__MM__.state.layout"),
                "theme": window.evaluate_js("window.__MM__.state.theme"),
            })
            check("py_save_roundtrip", res["ok"])
            re = main.load_map_file(str(tmp))
            check("py_reload_texts", re["ok"] and flat_texts(re["root"]) == flat_texts(doc2["root"]))
            check("py_layout_roundtrip", re["ok"] and re["layout"] == "timeline")
            check("py_theme_roundtrip", re["ok"] and re["theme"] == "dark")
            tmp.unlink(missing_ok=True)

            att_map = Path(__file__).resolve().parent / "_tmp_att.mm"
            att_map.write_bytes((ROOT / "samples" / "special.mm").read_bytes())
            src_txt = Path(__file__).resolve().parent / "_att_src.txt"
            src_txt.write_text("attachment content", encoding="utf-8")
            ra = api.add_attachment(str(att_map), str(src_txt))
            check("attach_copy_ok", ra["ok"] and bool(ra.get("data")))
            check("attach_embed_no_assets", not (att_map.parent / (att_map.stem + ".assets")).exists())
            ra_bad = api.open_attachment(str(att_map), "no_such_file.txt")
            check("attach_open_missing", ra_bad["ok"] is False)
            doc3 = main.load_map_file(str(att_map))
            doc3["layout"] = "fishbone"
            doc3["theme"] = "forest"
            doc3["root"]["attach"] = [{"name": ra["name"], "data": ra["data"]}]
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc3, ensure_ascii=False) + ")")
            time.sleep(0.8)
            raw4 = window.evaluate_js(
                "JSON.stringify({attachItems: document.querySelectorAll('#attach-list .attach-item').length,"
                " layout: window.__MM__.state.layout, theme: window.__MM__.state.theme,"
                " bones: (window.__MM__.state.decor&&window.__MM__.state.decor.bones||[]).length})"
            )
            ui4 = json.loads(raw4)
            check("ui_attach_panel", ui4["attachItems"] == 1)
            check("ui_layout_theme_loaded", ui4["layout"] == "fishbone" and ui4["theme"] == "forest")
            check("ui_fishbone_bones", ui4["bones"] >= 1)
            snap4 = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))
            res4 = main.save_map_file(str(att_map), {"root": snap4, "layout": "fishbone", "theme": "forest"})
            re4 = main.load_map_file(str(att_map))
            check("attach_file_roundtrip", res4["ok"] and re4["ok"] and re4["root"]["attach"] == doc3["root"]["attach"])
            att_map.unlink(missing_ok=True)
            src_txt.unlink(missing_ok=True)
            sc = att_map.parent / (att_map.stem + ".assets")
            if sc.exists():
                for f in sc.iterdir():
                    f.unlink()
                sc.rmdir()

            startup = api.take_startup_file()
            check("api_bridge_ok", startup is None and api.get_version()["name"] == main.APP_NAME)
            check("app_renamed", main.APP_NAME == "PyMindplot")

            # ── 附件全生命周期回归（对应用户"附件与格子断开"问题） ──
            api.set_dirty(True)
            check("dirty_sync_on", api._dirty is True)
            api.set_dirty(False)
            check("dirty_sync_off", api._dirty is False)

            lc_map = Path(__file__).resolve().parent / "_lc_att.mm"
            lc_map.write_bytes((ROOT / "samples" / "sample.mm").read_bytes())
            lc_src = Path(__file__).resolve().parent / "_lc_src.txt"
            lc_src.write_text("生命周期附件", encoding="utf-8")
            doc_lc = main.load_map_file(str(lc_map))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_lc, ensure_ascii=False) + ")")
            time.sleep(0.8)
            target_id = window.evaluate_js("window.__MM__.state.root.children[1].id")
            window.evaluate_js("window.__MM__.select(" + json.dumps(target_id) + ")")
            time.sleep(0.3)
            r_att = api.add_attachment(str(lc_map), str(lc_src))
            check("lc_copy_ok", r_att["ok"] and bool(r_att.get("data")))
            check("lc_embed_no_assets", not (lc_map.parent / (lc_map.stem + ".assets")).exists())
            mut = (
                "(() => { const M = window.__MM__;"
                " const n = M.MMModel.findNode(M.state.root, M.state.sel);"
                " if (!n) return 'no-node';"
                " if (!n.attach) n.attach = [];"
                " n.attach.push({ name: " + json.dumps(r_att["name"], ensure_ascii=False) +
                ", data: " + json.dumps(r_att["data"], ensure_ascii=False) + " });"
                " M.render(); M.doSave(false, true); return 'ok'; })()"
            )
            check("lc_mutate", window.evaluate_js(mut) == "ok")

            def _has_attach_on_child1():
                try:
                    t = ET.parse(str(lc_map))
                    nodes = t.getroot().find("node").findall("node")
                    return nodes[1].get("ATTACHMENTS") is not None
                except Exception:
                    return False

            saved = False
            for _ in range(30):
                time.sleep(0.3)
                if _has_attach_on_child1():
                    saved = True
                    break
            check("lc_persisted_to_xml", saved)

            re_lc = main.load_map_file(str(lc_map))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(re_lc, ensure_ascii=False) + ")")
            time.sleep(0.8)
            check("lc_reload_same_layout", re_lc["ok"])
            lc_child_id = window.evaluate_js("window.__MM__.state.root.children[1].id")
            lc_state = json.loads(window.evaluate_js(
                "JSON.stringify((n => ({attach: (n && n.attach) || []}))("
                "window.__MM__.MMModel.findNode(window.__MM__.state.root, "
                "window.__MM__.state.root.children[1].id)))"
            ))
            check("lc_reloaded_attach_on_node", lc_state["attach"] == [{"name": r_att["name"], "data": r_att["data"]}])
            ex_att = api.open_attachment(str(lc_map), {"name": r_att["name"], "data": "bad***"})
            check("lc_open_embed_bad_b64", ex_att["ok"] is False)
            window.evaluate_js("window.__MM__.select(" + json.dumps(lc_child_id) + ")")
            time.sleep(0.3)
            panel_cnt = window.evaluate_js("document.querySelectorAll('#attach-list .attach-item').length")
            check("lc_panel_after_reload", panel_cnt == 1)
            badge_vis = window.evaluate_js(
                "(() => { const list = Array.from(document.querySelectorAll('.mm-node:not(.root) .mm-attach-badge'));"
                " const b = list.find(x => x.style.display !== 'none');"
                " return !!b && b.dataset.id === window.__MM__.state.sel; })()"
            )
            check("lc_badge_on_node", badge_vis is True)
            window.evaluate_js(
                "window.__MM__.openAttachPopup(window.__MM__.state.sel, {clientX: 300, clientY: 300})"
            )
            time.sleep(0.2)
            pop_items = window.evaluate_js("document.querySelectorAll('#attach-pop .ap-item').length")
            check("lc_popup_from_node", pop_items == 1)
            window.evaluate_js("window.__MM__.closeAttachPopup()")
            rem = (
                "(() => { const M = window.__MM__;"
                " const n = M.MMModel.findNode(M.state.root, M.state.sel);"
                " n.attach.splice(0, 1); M.render(); M.doSave(false, true); return 'ok'; })()"
            )
            window.evaluate_js(rem)

            def _attach_cleared():
                try:
                    t = ET.parse(str(lc_map))
                    nodes = t.getroot().find("node").findall("node")
                    return nodes[1].get("ATTACHMENTS") is None
                except Exception:
                    return False

            cleared = False
            for _ in range(30):
                time.sleep(0.3)
                if _attach_cleared():
                    cleared = True
                    break
            check("lc_remove_persisted", cleared)
            lc_map.unlink(missing_ok=True)
            lc_src.unlink(missing_ok=True)
            lc_sc = lc_map.parent / (lc_map.stem + ".assets")
            if lc_sc.exists():
                for f in lc_sc.iterdir():
                    f.unlink()
                lc_sc.rmdir()

            # ── 多标签页：各自内容独立、切换后保持 ──
            tabs_info = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.getTabs())"))
            check("tab_initial_one", tabs_info["count"] == 1)
            window.evaluate_js("window.__MM__.addTab()")
            time.sleep(0.3)
            window.evaluate_js("window.__MM__.addChild(window.__MM__.state.root.id, {edit: false})")
            window.evaluate_js("window.__MM__.setNodeText(window.__MM__.state.root.children[0].id, '标签页B的内容')")
            t1_tree = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))
            window.evaluate_js("window.__MM__.switchTab(0)")
            time.sleep(0.5)
            t0_tree = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))
            t0_root_text = window.evaluate_js("window.__MM__.state.root.text")
            check("tab0_intact", t0_root_text == "产品规划" and not any(
                ch.get("text") == "标签页B的内容" for ch in t0_tree.get("children", [])))
            window.evaluate_js("window.__MM__.switchTab(1)")
            time.sleep(0.5)
            t1_back = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))
            check("tab1_preserved", t1_back == t1_tree and t1_back["children"][0]["text"] == "标签页B的内容")
            dom_tabs = window.evaluate_js("document.querySelectorAll('#tabbar .tab').length")
            active_idx = window.evaluate_js("document.querySelector('#tabbar .tab.active').dataset.idx")
            check("tab_dom", dom_tabs == 2 and active_idx == "1")
            window.evaluate_js("window.__MM__.state.modified = false")
            window.evaluate_js("window.__MM__.closeTab(1)")
            time.sleep(0.3)
            tabs_after = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.getTabs())"))
            check("tab_close", tabs_after["count"] == 1 and tabs_after["active"] == 0)

            # ── .xmind 导入：UI 全链路 ──
            dx = main.load_map_file(str(ROOT / "samples" / "sample.xmind"))
            check("xmind_load_ok", dx["ok"] and dx["format"] == "xmind")
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(dx, ensure_ascii=False) + ")")
            time.sleep(1.0)
            xui = json.loads(window.evaluate_js(
                "JSON.stringify({nodes: document.querySelectorAll('.mm-node').length,"
                " rootText: (document.querySelector('.mm-node.root .mm-node-text')||{}).textContent,"
                " texts: Array.from(document.querySelectorAll('.mm-node-text')).map(e=>e.textContent)})"
            ))
            check("xmind_ui_root", xui["rootText"] == "无人机新产品立项")
            check("xmind_ui_count", xui["nodes"] == 12)
            check("xmind_ui_marker", any(t.startswith("➊ 市场分析") for t in xui["texts"]))
            check("xmind_ui_notes", any("[备注] 低空经济政策利好" in t for t in xui["texts"]))
            check("xmind_ui_label", any("[标签] 评审中" in t for t in xui["texts"]))
            check("xmind_ui_title", "sample.xmind" in window.evaluate_js("document.title"))
            # 导入后保存 → 引导为 .mm（JS doSave 对 xmind 强制另存；此处直接验证 Python 侧转换链路）
            xsave = Path(__file__).resolve().parent / "_xmind_conv.mm"
            xres = main.save_map_file(str(xsave), json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())")))
            xre = main.load_map_file(str(xsave))
            check("xmind_convert_roundtrip", xres["ok"] and xre["ok"] and xre["root"]["text"] == "无人机新产品立项")
            xsave.unlink(missing_ok=True)
            xguard = main.save_map_file(str(ROOT / "samples" / "sample.xmind"), {"root": xre["root"]})
            check("xmind_no_overwrite", xguard["ok"] is False)

            # ── 节点尺寸：手动调整持久化 + 一键优化 ──
            sz_map = Path(__file__).resolve().parent / "_sz.mm"
            sz_map.write_bytes((ROOT / "samples" / "sample.mm").read_bytes())
            doc_sz = main.load_map_file(str(sz_map))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_sz, ensure_ascii=False) + ")")
            time.sleep(0.8)
            sz_id = window.evaluate_js("window.__MM__.state.root.children[0].id")
            window.evaluate_js("window.__MM__.setNodeSize(" + json.dumps(sz_id) + ", 180, 56)")
            time.sleep(0.3)
            sz_ui = window.evaluate_js(
                "(() => { const el = window.__MM__.MMRender.getNodeEl(" + json.dumps(sz_id) + ");"
                " return el.style.width + 'x' + el.style.height; })()"
            )
            check("sz_ui_applied", sz_ui == "180pxx56px")
            window.evaluate_js("window.__MM__.doSave(false, true)")

            def _has_width_attr():
                try:
                    return b'WIDTH="180"' in sz_map.read_bytes() and b'HEIGHT="56"' in sz_map.read_bytes()
                except Exception:
                    return False

            sz_saved = False
            for _ in range(30):
                time.sleep(0.3)
                if _has_width_attr():
                    sz_saved = True
                    break
            check("sz_persisted_xml", sz_saved)
            re_sz = main.load_map_file(str(sz_map))
            sz_node = re_sz["root"]["children"][0] if re_sz["ok"] else {}
            check("sz_reload", sz_node.get("w") == 180 and sz_node.get("h") == 56)
            window.evaluate_js("window.__MM__.optimizeSizes()")
            time.sleep(0.8)
            opt = json.loads(window.evaluate_js(
                "JSON.stringify((() => { let ok = true, n = 0;"
                " window.__MM__.MMModel.walk(window.__MM__.state.root, (x) => {"
                "  const el = window.__MM__.MMRender.getNodeEl(x.id);"
                "  if (el && !el.classList.contains('hidden')) { n++; if (!(x.w > 0 && x.h > 0)) ok = false; } });"
                " return {rootW: window.__MM__.state.root.w || 0, allSized: ok && n > 0}; })())"
            ))
            check("sz_optimize_all", opt["rootW"] >= 150 and opt["allSized"] is True)
            window.evaluate_js("window.__MM__.doSave(false, true)")
            time.sleep(1.0)
            re_opt = main.load_map_file(str(sz_map))
            check("sz_optimize_persisted", re_opt["ok"] and re_opt["root"]["w"] >= 150)
            sz_map.unlink(missing_ok=True)

            # ── v1.6：xmind 导入后自动保存直接落 .mm，不再弹另存为（回归） ──
            xa = Path(__file__).resolve().parent / "_xa.xmind"
            xa.write_bytes((ROOT / "samples" / "sample.xmind").read_bytes())
            xa_before = xa.read_bytes()
            doc_xa = main.load_map_file(str(xa))
            check("xa_load_ok", doc_xa["ok"] and doc_xa["format"] == "xmind")
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_xa, ensure_ascii=False) + ")")
            time.sleep(0.8)
            xa_id = window.evaluate_js("window.__MM__.state.root.children[0].id")
            window.evaluate_js("window.__MM__.setNodeSize(" + json.dumps(xa_id) + ", 160, 50)")
            window.evaluate_js("window.__MM__.doSave(false, true)")
            xa_mm = Path(__file__).resolve().parent / "_xa.mm"
            xa_saved = False
            for _ in range(30):
                time.sleep(0.3)
                if xa_mm.exists() and b'WIDTH="160"' in xa_mm.read_bytes():
                    xa_saved = True
                    break
            check("xmind_autosave_mm", xa_saved)
            check("xmind_original_untouched", xa.read_bytes() == xa_before)
            xa_state = json.loads(window.evaluate_js(
                "JSON.stringify({path: window.__MM__.state.path, format: window.__MM__.state.format,"
                " name: window.__MM__.state.name})"))
            check("xmind_state_derived", xa_state["format"] == "mm"
                  and xa_state["name"] == "_xa.mm" and xa_state["path"].endswith("_xa.mm"))
            xa.unlink(missing_ok=True)
            xa_mm.unlink(missing_ok=True)

            # ── v1.6：格式功能（字号/斜体/下划线/LaTeX/清除样式） ──
            fm = Path(__file__).resolve().parent / "_fmt.mm"
            froot = main._base_node("格式中心")
            fk = main._base_node("公式节点")
            fk["fs"] = 22
            fk["it"] = True
            fk["ul"] = True
            fk["latex"] = "\\frac{a}{b}"
            froot["children"] = [fk]
            main.save_map_file(str(fm), froot)
            doc_f = main.load_map_file(str(fm))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_f, ensure_ascii=False) + ")")
            time.sleep(0.8)
            fk_id = window.evaluate_js("window.__MM__.state.root.children[0].id")
            fui = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const el = window.__MM__.MMRender.getNodeEl(" + json.dumps(fk_id) + ");"
                " const t = el.querySelector('.mm-node-text'); const lx = el.querySelector('.mm-latex');"
                " return {fs: t.style.fontSize, it: el.classList.contains('italic'),"
                "  ul: el.classList.contains('underline'), latexShown: lx.style.display !== 'none',"
                "  hasFrac: lx.innerHTML.indexOf('mx-frac') >= 0}; })())"))
            check("fmt_ui_fontsize", fui["fs"] == "22px")
            check("fmt_ui_italic", fui["it"] is True)
            check("fmt_ui_underline", fui["ul"] is True)
            check("fmt_ui_latex_frac", fui["latexShown"] is True and fui["hasFrac"] is True)
            window.evaluate_js("window.__MM__.select(" + json.dumps(fk_id) + ")")
            time.sleep(0.3)
            panel = json.loads(window.evaluate_js(
                "JSON.stringify({it: document.getElementById('chk-italic').checked,"
                " ul: document.getElementById('chk-underline').checked,"
                " fs: document.getElementById('sel-fontsize').value,"
                " latex: document.getElementById('inp-latex').value})"))
            check("fmt_panel_sync", panel["it"] is True and panel["ul"] is True
                  and panel["fs"] == "22" and panel["latex"] == "\\frac{a}{b}")
            window.evaluate_js(
                "(() => { const sf = document.getElementById('sel-fontsize');"
                " sf.value = '16'; sf.dispatchEvent(new Event('change')); })()")
            time.sleep(0.3)
            check("fmt_panel_fontsize_apply", window.evaluate_js(
                "window.__MM__.state.root.children[0].fs") == 16)
            window.evaluate_js("document.getElementById('btn-style-clear').click()")
            time.sleep(0.3)
            cleared = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const n = window.__MM__.state.root.children[0];"
                " return {fs: n.fs, it: n.it, ul: n.ul}; })())"))
            check("fmt_clear_style", cleared["fs"] == 0 and cleared["it"] is False and cleared["ul"] is False)
            window.evaluate_js(
                "window.__MM__.applyNodeStyle(window.__MM__.state.root.children[0].id,"
                " (n) => { n.latex = 'E=mc^2'; })")
            window.evaluate_js("window.__MM__.doSave(false, true)")
            time.sleep(1.0)
            re_f = main.load_map_file(str(fm))
            fk_re = re_f["root"]["children"][0] if re_f["ok"] else {}
            check("fmt_latex_persisted", fk_re.get("latex") == "E=mc^2" and fk_re.get("fs") == 0)
            fm.unlink(missing_ok=True)

            # ── v1.8：粘贴图片内嵌（无 .assets）+ 真实加载校验 ──
            im = Path(__file__).resolve().parent / "_img.mm"
            main.save_map_file(str(im), main._base_node("图片中心"))
            png1x1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
            ri = api.add_image(str(im), png1x1, "png")
            check("img_add_ok", ri["ok"] and ri["name"] == "粘贴图片.png" and bool(ri.get("data")))
            check("img_embed_no_assets", not (im.parent / "_img.assets").exists())
            doc_i = main.load_map_file(str(im))
            doc_i["root"]["img"] = ri["name"]
            doc_i["root"]["imgdata"] = ri["data"]
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_i, ensure_ascii=False) + ")")
            time.sleep(1.2)
            img_ui = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const el = document.querySelector('.mm-node.root .mm-node-img');"
                " return {shown: el.style.display !== 'none',"
                "  isDataUrl: (el.getAttribute('src')||'').indexOf('data:image/png;base64,') === 0,"
                "  loaded: el.naturalWidth > 0,"
                "  hasImg: document.querySelector('.mm-node.root').classList.contains('has-img')}; })())"))
            check("img_ui_rendered", img_ui["shown"] is True and img_ui["isDataUrl"] is True
                  and img_ui["loaded"] is True and img_ui["hasImg"] is True)
            window.evaluate_js("window.__MM__.doSave(false, true)")
            time.sleep(1.0)
            re_i = main.load_map_file(str(im))
            check("img_persisted", re_i["ok"] and re_i["root"].get("img") == "粘贴图片.png"
                  and re_i["root"].get("imgdata") == png1x1)

            # ── v1.8：旧版 .assets 图片仍可显示（file URL 兜底） ──
            old_im = Path(__file__).resolve().parent / "_oldimg.mm"
            main.save_map_file(str(old_im), main._base_node("旧图中心"))
            old_sc = old_im.parent / "_oldimg.assets"
            old_sc.mkdir(exist_ok=True)
            (old_sc / "旧图.png").write_bytes(base64.b64decode(png1x1))
            doc_o = main.load_map_file(str(old_im))
            doc_o["root"]["img"] = "旧图.png"
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_o, ensure_ascii=False) + ")")
            time.sleep(1.2)
            old_ui = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const el = document.querySelector('.mm-node.root .mm-node-img');"
                " return {hasSrc: (el.getAttribute('src')||'').length > 0,"
                "  loaded: el.naturalWidth > 0}; })())"))
            check("old_img_fileurl_loads", old_ui["hasSrc"] is True and old_ui["loaded"] is True)
            ex_old = api.open_attachment(str(old_im), {"name": "旧图.png", "rel": "旧图.png"})
            check("old_attach_rel_opens", ex_old["ok"] is True)
            old_im.unlink(missing_ok=True)
            if old_sc.exists():
                for f in old_sc.iterdir():
                    f.unlink()
                old_sc.rmdir()
            im.unlink(missing_ok=True)

            # ── v1.8：Ctrl+V 键盘路径回归（空内部剪贴板时放行原生 paste） ──
            cv = json.loads(window.evaluate_js(
                "JSON.stringify((() => {"
                " const ev1 = new KeyboardEvent('keydown', {key:'v', ctrlKey:true, bubbles:true, cancelable:true});"
                " const pass1 = document.dispatchEvent(ev1);"
                " window.__MM__.copyNode(window.__MM__.state.root.id);"
                " const ev2 = new KeyboardEvent('keydown', {key:'v', ctrlKey:true, bubbles:true, cancelable:true});"
                " const pass2 = document.dispatchEvent(ev2);"
                " window.__MM__.undo();"
                " return {nativeAllowed: pass1 === true, nodePasteCancels: pass2 === false}; })())"))
            check("ctrlv_native_when_no_clip", cv["nativeAllowed"] is True)
            check("ctrlv_node_paste_still_works", cv["nodePasteCancels"] is True)

            # ── v1.9：文件粘贴 → 附件内嵌 + 文件名填入格子 ──
            fp = Path(__file__).resolve().parent / "_fp.mm"
            fp_root = main._base_node("文件粘贴")
            fp_kid = main._base_node("目标格子")
            fp_root["children"] = [fp_kid]
            main.save_map_file(str(fp), fp_root)
            doc_fp = main.load_map_file(str(fp))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_fp, ensure_ascii=False) + ")")
            time.sleep(0.8)
            fp_id = window.evaluate_js("window.__MM__.state.root.children[0].id")
            zip_bytes = base64.b64encode(b"PK\x03\x04 fake zip content for paste test \xe6\xb5\x8b\xe8\xaf\x95").decode("ascii")
            window.evaluate_js(
                "window.__FP__ = null;"
                "(async () => {"
                " const bytes = Uint8Array.from(atob(" + json.dumps(zip_bytes) + "), c => c.charCodeAt(0));"
                " const f = new File([bytes], '测试.zip', {type: 'application/zip'});"
                " const ok = await window.__MM__.pasteFilesIntoNode(" + json.dumps(fp_id) + ", [f]);"
                " const n = window.__MM__.MMModel.findNode(window.__MM__.state.root, " + json.dumps(fp_id) + ");"
                " window.__FP__ = {ok: ok, text: n.text, attName: n.attach[0] && n.attach[0].name,"
                "  hasData: !!(n.attach[0] && n.attach[0].data)}; })()")
            fp_res = {}
            for _ in range(40):
                time.sleep(0.3)
                fp_res = json.loads(window.evaluate_js("JSON.stringify(window.__FP__)") or "{}")
                if fp_res:
                    break
            check("fp_paste_ok", fp_res.get("ok") is True)
            check("fp_text_filled", fp_res["text"] == "测试.zip")
            check("fp_attach_embedded", fp_res["attName"] == "测试.zip" and fp_res["hasData"] is True)
            window.evaluate_js("window.__MM__.doSave(false, true)")
            time.sleep(1.0)
            re_fp = main.load_map_file(str(fp))
            fp_node = re_fp["root"]["children"][0] if re_fp["ok"] else {}
            check("fp_persisted", fp_node.get("text") == "测试.zip"
                  and fp_node.get("attach") and fp_node["attach"][0].get("name") == "测试.zip")
            check("fp_no_assets", not (fp.parent / "_fp.assets").exists())
            # 附件另存为：字节与原文件一致
            save_dest = Path(__file__).resolve().parent / "_fp_out.zip"
            save_dest.unlink(missing_ok=True)
            att_entry = fp_node["attach"][0]
            rs = api.save_attachment_as(str(fp), att_entry, str(save_dest))
            check("fp_saveas_identical", rs["ok"] and save_dest.read_bytes() == base64.b64decode(zip_bytes))
            save_dest.unlink(missing_ok=True)
            # 右键菜单：无附件只有"插入附件"，有附件两项都有
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(re_fp, ensure_ascii=False) + ")")
            time.sleep(0.8)
            fp_id2 = window.evaluate_js("window.__MM__.state.root.children[0].id")
            window.evaluate_js("window.__MM__.select(" + json.dumps(fp_id2) + ")")
            window.evaluate_js("window.__MM__.openCtxMenu(300, 300)")
            ctx1 = json.loads(window.evaluate_js(
                "JSON.stringify({count: document.querySelectorAll('#ctx-menu .ctx-item').length,"
                " attachSaveDisabled: document.querySelector('#ctx-menu [data-act=\"attach-save\"]').classList.contains('disabled'),"
                " attachEnabled: !document.querySelector('#ctx-menu [data-act=\"attach\"]').classList.contains('disabled')})"))
            check("ctx_with_attach_state", ctx1["count"] == 10 and ctx1["attachSaveDisabled"] is False
                  and ctx1["attachEnabled"] is True)
            window.evaluate_js("window.__MM__.closeCtxMenu()")
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.id)")
            window.evaluate_js("window.__MM__.openCtxMenu(300, 300)")
            ctx2 = json.loads(window.evaluate_js(
                "JSON.stringify({attachSaveDisabled: document.querySelector('#ctx-menu [data-act=\"attach-save\"]').classList.contains('disabled')})"))
            check("ctx_no_attach_save_disabled", ctx2["attachSaveDisabled"] is True)
            window.evaluate_js("window.__MM__.closeCtxMenu()")
            fp.unlink(missing_ok=True)

            # ── v1.10：查找替换（计数/循环/全字匹配/全部替换确认） ──
            fd_map = Path(__file__).resolve().parent / "_find.mm"
            fd_map.write_bytes((ROOT / "samples" / "sample.mm").read_bytes())
            doc_f = main.load_map_file(str(fd_map))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_f, ensure_ascii=False) + ")")
            time.sleep(0.8)

            def _count_word(root_obj, word):
                total = 0

                def rec(n):
                    nonlocal total
                    total += len(_re.findall(word, n.get("text", "")))
                    for c in n.get("children", []):
                        rec(c)

                rec(root_obj)
                return total

            expected = _count_word(doc_f["root"], "能")
            check("find_precondition", expected >= 2)
            window.evaluate_js("window.__MM__.openFind(false)")
            time.sleep(0.3)
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-find'); i.value = '能';"
                " i.dispatchEvent(new Event('input')); })()")
            time.sleep(0.4)
            fr = json.loads(window.evaluate_js(
                "JSON.stringify({count: document.getElementById('find-count').textContent,"
                " hits: document.querySelectorAll('.mm-node.find-hit').length})"))
            check("find_count_matches", fr["count"] == "1/" + str(expected))
            check("find_hits_marked", fr["hits"] >= 2)
            window.evaluate_js(
                "(() => { for (let i = 0; i < " + str(expected) + "; i++)"
                " document.getElementById('btn-find-next').click(); })()")
            fr2 = window.evaluate_js("document.getElementById('find-count').textContent")
            check("find_wraps", fr2 == "1/" + str(expected))
            window.evaluate_js(
                "(() => { const c = document.getElementById('chk-word'); c.checked = true;"
                " const i = document.getElementById('inp-find'); i.dispatchEvent(new Event('input')); })()")
            time.sleep(0.3)
            fr3 = window.evaluate_js("document.getElementById('find-count').textContent")
            fr3_parts = fr3.split("/")
            check("find_word_option", len(fr3_parts) == 2 and fr3_parts[1] == str(expected))
            window.evaluate_js(
                "(() => { const c = document.getElementById('chk-word'); c.checked = false;"
                " const i = document.getElementById('inp-find'); i.dispatchEvent(new Event('input')); })()")
            time.sleep(0.3)
            window.evaluate_js(
                "(() => { document.getElementById('inp-replace').value = '环节';"
                " document.getElementById('btn-replace-all').click(); })()")
            time.sleep(0.5)
            modal_vis = window.evaluate_js("!document.getElementById('modal').classList.contains('hidden')")
            check("find_confirm_shown", modal_vis is True)
            window.evaluate_js("document.getElementById('modal-ok').click()")
            time.sleep(1.2)
            snap_fr = json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))
            check("find_replace_all_done", _count_word(snap_fr, "能") == 0)
            check("find_replace_count", _count_word(snap_fr, "环节") == expected)
            fr4 = window.evaluate_js("document.getElementById('find-count').textContent")
            check("find_count_after", fr4 == "无匹配")
            window.evaluate_js("window.__MM__.closeFind()")
            hits_after = window.evaluate_js("document.querySelectorAll('.mm-node.find-hit').length")
            check("find_close_clears", hits_after == 0)

            # ── v1.10：右键框选 + Del 批量删除 ──
            mr = json.loads(window.evaluate_js(
                "JSON.stringify((() => {"
                " const cv = document.getElementById('canvas');"
                " const rc = cv.getBoundingClientRect();"
                " const mk = (t, x, y, b) => new MouseEvent(t, {button: b, buttons: b, clientX: x, clientY: y, bubbles: true, cancelable: true});"
                " const ax = rc.left + window.__MM__.state.pan.x + (-5000) * window.__MM__.state.zoom;"
                " const ay = rc.top + window.__MM__.state.pan.y + (-5000) * window.__MM__.state.zoom;"
                " cv.dispatchEvent(mk('mousedown', ax, ay, 2));"
                " window.dispatchEvent(mk('mousemove', ax + 60000, ay + 60000, 2));"
                " window.dispatchEvent(mk('mouseup', ax + 60000, ay + 60000, 2));"
                " return {multi: window.__MM__.state.multiSel.size}; })())"))
            check("marquee_selects", mr["multi"] >= 2)
            cnt_before = len(flat_texts(json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))))
            window.evaluate_js(
                "document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Delete', bubbles: true, cancelable: true}))")
            time.sleep(0.4)
            cnt_after = len(flat_texts(json.loads(window.evaluate_js("JSON.stringify(window.__MM__.cleanTree())"))))
            check("marquee_batch_delete", cnt_before >= 11 and cnt_after == 1)
            fd_map.unlink(missing_ok=True)

            RESULTS["ok"] = all(v is True for v in RESULTS.values())

            # ── v1.7：按层级调整大小 ──
            lv = Path(__file__).resolve().parent / "_lvl.mm"
            lv_root = main._base_node("层级根")
            l1 = main._base_node("一级节点")
            l2 = main._base_node("二级节点")
            l1["children"] = [l2]
            lv_root["children"] = [l1]
            main.save_map_file(str(lv), lv_root)
            doc_lv = main.load_map_file(str(lv))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_lv, ensure_ascii=False) + ")")
            time.sleep(0.8)
            window.evaluate_js("window.__MM__.applyLevelSizes()")
            time.sleep(0.5)
            lvl = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const r = window.__MM__.state.root;"
                " const c = r.children[0]; const g = c.children[0];"
                " return {rw: r.w, rf: r.fs, cw: c.w, cf: c.fs, gw: g.w, gf: g.fs}; })())"))
            check("lvl_root_largest", lvl["rw"] > lvl["cw"] > lvl["gw"] and lvl["rf"] > lvl["cf"] > lvl["gf"])
            check("lvl_height_set", lvl["rw"] >= 96)
            window.evaluate_js("window.__MM__.doSave(false, true)")
            time.sleep(1.0)
            re_lv = main.load_map_file(str(lv))
            check("lvl_fs_persisted", re_lv["ok"] and re_lv["root"]["fs"] == lvl["rf"]
                  and re_lv["root"]["children"][0]["fs"] == lvl["cf"])

            # ── v1.7：导出高 DPI PNG（E2E：渲染→落盘） ──
            png_target = Path(__file__).resolve().parent / "_lvl.png"
            png_target.unlink(missing_ok=True)
            window.evaluate_js("window.__MM__.exportPNG()")
            png_ok = False
            for _ in range(40):
                time.sleep(0.3)
                if png_target.exists() and png_target.stat().st_size > 5000:
                    png_ok = True
                    break
            check("png_export_e2e", png_ok and png_target.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n")

            # ── v1.8：DPI 选项（600 DPI 输出尺寸 > 200 DPI） ──
            def _png_width(p):
                with open(p, "rb") as fh:
                    fh.seek(16)
                    return int.from_bytes(fh.read(4), "big")

            w200 = _png_width(png_target)
            window.evaluate_js(
                "(() => { const s = document.getElementById('sel-export-dpi');"
                " s.value = '600'; s.dispatchEvent(new Event('change')); })()")
            window.evaluate_js("window.__MM__.exportPNG()")
            w600 = 0
            for _ in range(40):
                time.sleep(0.3)
                if png_target.exists() and png_target.stat().st_size > 5000:
                    w600 = _png_width(png_target)
                    if w600 > 0:
                        break
            check("png_dpi600_bigger", w600 > w200 > 0)
            window.evaluate_js(
                "(() => { const s = document.getElementById('sel-export-dpi');"
                " s.value = '200'; s.dispatchEvent(new Event('change')); })()")
            sp_bad = api.save_png(str(lv), "###")
            check("png_save_bad", sp_bad["ok"] is False)
            rid = api.read_image_data(str(lv), "nope.png")
            check("img_read_missing", rid["ok"] is False)
            lv.unlink(missing_ok=True)
            png_target.unlink(missing_ok=True)

            # ── v1.11：层级字号 + 追踪模式 ──
            tk = Path(__file__).resolve().parent / "_track.mm"
            tk_root = main._base_node("追踪根")
            tk_root["children"] = []
            for _i in range(1, 25):
                _short = _i % 2 == 0
                tk_root["children"].append({
                    "text": ("短节点%d" % _i) if _short else ("追踪分支节点%02d号内容较长用于撑大整体布局范围的测试文本" % _i),
                    "children": [] if _short else [{"text": "孙辈节点%02d号内容也要足够长以便向两侧继续撑出视口范围" % _i}],
                })
            main.save_map_file(str(tk), tk_root)
            doc_tk = main.load_map_file(str(tk))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_tk, ensure_ascii=False) + ")")
            time.sleep(0.8)
            lf = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const r = document.querySelector('.mm-node.root .mm-node-text');"
                " const c = window.__MM__.state.root.children[0];"
                " const ce = window.__MM__.MMRender.getNodeEl(c.id).querySelector('.mm-node-text');"
                " return {root: r.style.fontSize, child: ce.style.fontSize}; })())"))
            check("track_level_fonts", lf["root"] == "18px" and lf["child"] == "16px")
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.id)")
            window.evaluate_js("window.__MM__.toggleTrack()")
            time.sleep(0.5)
            tr1 = json.loads(window.evaluate_js(
                "JSON.stringify((() => { const M = window.__MM__;"
                " const sel = M.MMRender.getNodeEl(M.state.sel);"
                " let mid = 0, ghost = 0, orphanSharp = 0, scaledOthers = 0;"
                " const op = new Map();"
                " document.querySelectorAll('.mm-node').forEach((el) => {"
                "  const o = el.style.opacity === '' ? 1 : parseFloat(el.style.opacity);"
                "  op.set(el.dataset.id, o);"
                "  if (o < 0.04) ghost++; else if (o < 0.99) mid++;"
                "  if (el.dataset.id !== M.state.sel && el.style.transform.indexOf('scale') >= 0) scaledOthers++; });"
                " (function rec(n, parent){"
                "  const o = op.get(n.id) || 0;"
                "  if (o >= 0.5) {"
                "   const pOk = parent && (op.get(parent.id) || 0) >= 0.1;"
                "   const cOk = (n.children||[]).some((c) => (op.get(c.id) || 0) >= 0.1);"
                "   if (!pOk && !cOk) orphanSharp++;"
                "  }"
                "  (n.children||[]).forEach((c) => rec(c, n)); })(M.state.root, null);"
                " const circ = document.getElementById('track-circle');"
                " return {on: M.state.trackMode,"
                " btn: document.getElementById('btn-track').classList.contains('active'),"
                " selOp: sel.style.opacity === '' ? 1 : parseFloat(sel.style.opacity),"
                " selTf: sel.style.transform, mid: mid, ghost: ghost, orphanSharp: orphanSharp,"
                " scaledOthers: scaledOthers,"
                " circle: circ && !circ.classList.contains('hidden') && parseFloat(circ.style.width) > 0}; })())"))
            check("track_on_fades", tr1["on"] is True and tr1["btn"] is True
                  and tr1["selOp"] >= 0.99 and "scale(1.5)" in tr1["selTf"]
                  and (tr1["mid"] > 0 or tr1["ghost"] > 0))
            check("track_no_orphans", tr1["orphanSharp"] == 0)
            check("track_scale_only_sel", tr1["scaledOthers"] == 0)
            check("track_circle_shown", tr1["circle"] is True)
            window.evaluate_js("window.__MM__.setLayout('timeline')")
            time.sleep(0.4)
            window.evaluate_js("window.__MM__.setLayout('map-balance')")
            time.sleep(0.4)
            edge_count = window.evaluate_js("document.querySelectorAll('#edgeG path').length")
            check("track_edges_after_relayout", edge_count >= 16)
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.id)")
            time.sleep(0.3)
            # ── v1.15：方向键弹出迷你导图 + 编号跳转 ──
            pop = Path(__file__).resolve().parent / "_pop.mm"
            pop_root = main._base_node("弹窗根节点")
            pop_anchor = main._base_node("锚点格子A")
            pop_anchor["children"] = [{"text": "子格%d号内容" % i, "children": []} for i in range(1, 21)]
            pop_root["children"] = [pop_anchor]
            main.save_map_file(str(pop), pop_root)
            doc_pop = main.load_map_file(str(pop))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_pop, ensure_ascii=False) + ")")
            time.sleep(0.6)
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.children[0].id)")
            window.evaluate_js("if (!window.__MM__.state.trackMode) window.__MM__.toggleTrack()")
            time.sleep(0.4)
            check("track_sel_on_top", window.evaluate_js(
                "getComputedStyle(window.__MM__.MMRender.getNodeEl(window.__MM__.state.sel)).zIndex") == "30")

            def pop_state():
                return json.loads(window.evaluate_js("JSON.stringify(window.__MM__.getTrackPopup())"))

            def press(key):
                window.evaluate_js(
                    "document.dispatchEvent(new KeyboardEvent('keydown', {key: '" + key + "', bubbles: true, cancelable: true}))")
                time.sleep(0.15)

            press("ArrowRight")
            p1 = pop_state()
            check("track_pop_opens", p1["open"] is True and p1["side"] == "right"
                  and p1["right"] == 20 and p1["left"] == 1)
            check("track_pop_badges", window.evaluate_js(
                "document.querySelectorAll('#track-pop .tp-badge').length") == 21
                and window.evaluate_js(
                    "!document.getElementById('track-pop').classList.contains('hidden')") is True)
            check("track_pop_sizing", window.evaluate_js(
                "(() => { const el = document.getElementById('track-pop');"
                " return Math.abs(el.offsetWidth / el.offsetHeight - 1.618) < 0.05"
                " && el.offsetHeight / window.innerHeight > 0.5"
                " && el.offsetHeight <= window.innerHeight - 20; })()") is True)
            check("track_pop_cells_phi", window.evaluate_js(
                "(() => { let ok = true, sideW = 0, cenW = 0;"
                " document.querySelectorAll('#track-pop .tp-node').forEach((el) => {"
                " if (Math.abs(el.offsetWidth / el.offsetHeight - 1.618) > 0.06) ok = false;"
                " if (el.classList.contains('center')) cenW = el.offsetWidth; else sideW = el.offsetWidth; });"
                " return ok && sideW > 0 && cenW > 0"
                " && Math.abs((cenW / sideW) - 1.618) < 0.1; })()") is True)
            window.resize(1500, 920)
            time.sleep(0.8)
            check("track_pop_resize_sync", window.evaluate_js(
                "(() => { const el = document.getElementById('track-pop');"
                " return Math.abs(el.offsetWidth / el.offsetHeight - 1.618) < 0.05"
                " && el.offsetHeight / window.innerHeight > 0.5; })()") is True)
            window.resize(1100, 760)
            time.sleep(0.8)
            press("1")
            press("5")
            check("track_pop_buffer", pop_state()["buffer"] == "15")
            press("Enter")
            time.sleep(0.3)
            sel_text = window.evaluate_js(
                "window.__MM__.MMModel.findNode(window.__MM__.state.root, window.__MM__.state.sel).text")
            check("track_pop_jump15", sel_text == "子格15号内容" and pop_state()["open"] is False)
            anchor_id = window.evaluate_js("window.__MM__.state.root.children[0].id")
            root_id = window.evaluate_js("window.__MM__.state.root.id")
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.children[0].id)")
            time.sleep(0.2)
            press("ArrowLeft")
            time.sleep(0.3)
            check("track_pop_single_left",
                  window.evaluate_js("window.__MM__.state.sel") == root_id
                  and pop_state()["open"] is False)
            press("ArrowRight")
            time.sleep(0.3)
            check("track_pop_single_right",
                  window.evaluate_js("window.__MM__.state.sel") == anchor_id
                  and pop_state()["open"] is False)
            press("ArrowRight")
            press("9")
            press("9")
            press("Enter")
            check("track_pop_out_of_range", pop_state()["open"] is True
                  and window.evaluate_js("window.__MM__.state.sel") == anchor_id)
            press("Escape")
            check("track_pop_esc_closes", pop_state()["open"] is False)
            press("ArrowRight")
            press("ArrowLeft")
            time.sleep(0.3)
            check("track_pop_cross_single",
                  window.evaluate_js("window.__MM__.state.sel") == root_id
                  and pop_state()["open"] is False)
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.children[0].id)")
            time.sleep(0.2)
            press("ArrowRight")
            window.evaluate_js(
                "document.getElementById('canvas').dispatchEvent(new MouseEvent('mousedown', {bubbles: true}))")
            time.sleep(0.15)
            check("track_pop_outside_closes", pop_state()["open"] is False)
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_tk, ensure_ascii=False) + ")")
            time.sleep(0.6)
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.id)")
            window.evaluate_js("if (!window.__MM__.state.trackMode) window.__MM__.toggleTrack()")
            time.sleep(0.3)
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-track-zoom');"
                " i.value = '2'; i.dispatchEvent(new Event('change')); })()")
            time.sleep(0.3)
            zf = window.evaluate_js(
                "window.__MM__.MMRender.getNodeEl(window.__MM__.state.sel).style.transform")
            check("track_zoom_input", "scale(2)" in zf)
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-track-zoom');"
                " i.value = '1.5'; i.dispatchEvent(new Event('change')); })()")
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-track-range');"
                " i.value = '100'; i.dispatchEvent(new Event('change')); })()")
            time.sleep(0.3)
            faded_at = ("(() => { let g = 0; document.querySelectorAll('.mm-node').forEach((el) => {"
                        " const op = el.style.opacity === '' ? 1 : parseFloat(el.style.opacity);"
                        " if (op < 0.99) g++; }); return g; })()")
            faded65 = tr1["mid"] + tr1["ghost"]
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-track-range');"
                " i.value = '100'; i.dispatchEvent(new Event('change')); })()")
            time.sleep(0.3)
            f100 = window.evaluate_js(faded_at)
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-track-range');"
                " i.value = '30'; i.dispatchEvent(new Event('change')); })()")
            time.sleep(0.3)
            f30 = window.evaluate_js(faded_at)
            check("track_range_scales", f100 < faded65 and f30 > faded65)
            window.evaluate_js(
                "(() => { const i = document.getElementById('inp-track-range');"
                " i.value = '65'; i.dispatchEvent(new Event('change')); })()")
            time.sleep(0.3)
            pan1 = window.evaluate_js("JSON.stringify(window.__MM__.state.pan)")
            fade1 = window.evaluate_js("JSON.stringify(Array.from(window.__MM__.state.trackFade.entries()))")
            window.evaluate_js("window.__MM__.select(window.__MM__.state.root.children[15].id)")
            time.sleep(0.5)
            fade2 = window.evaluate_js("JSON.stringify(Array.from(window.__MM__.state.trackFade.entries()))")
            pan2 = window.evaluate_js("JSON.stringify(window.__MM__.state.pan)")
            check("track_follows_sel", fade2 != fade1 and pan2 != pan1)
            window.evaluate_js(
                "document.dispatchEvent(new KeyboardEvent('keydown', {key: 'F4', bubbles: true, cancelable: true}))")
            time.sleep(0.3)
            tr3 = json.loads(window.evaluate_js(
                "JSON.stringify({on: window.__MM__.state.trackMode,"
            " dirty: Array.from(document.querySelectorAll('.mm-node')).some((el) =>"
            " el.style.opacity !== '' || el.style.transform.indexOf('scale') >= 0)})"))
            check("track_f4_off_restores", tr3["on"] is False and tr3["dirty"] is False)
            tk.unlink(missing_ok=True)

            # ── v1.12：按层级调整（深层级动态字号） ──
            dp = Path(__file__).resolve().parent / "_deep.mm"
            deep_root = main._base_node("深层根")
            cur = deep_root
            for i in range(8):
                nxt = main._base_node("第%d层级节点" % (i + 1))
                cur["children"] = [nxt]
                cur = nxt
            main.save_map_file(str(dp), deep_root)
            doc_dp = main.load_map_file(str(dp))
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc_dp, ensure_ascii=False) + ")")
            time.sleep(0.8)
            window.evaluate_js("window.__MM__.applyLevelSizes()")
            time.sleep(0.5)
            dfs = window.evaluate_js(
                "(function(){ const out = []; let n = window.__MM__.state.root;"
                " while (n) { const el = window.__MM__.MMRender.getNodeEl(n.id);"
                " out.push(parseFloat(el.querySelector('.mm-node-text').style.fontSize));"
                " n = n.children[0]; } return JSON.stringify(out); })()")
            dfs = json.loads(dfs)
            check("lvl_deep_gradient", len(dfs) == 9 and dfs[0] == 26 and dfs[-1] == 13
                  and all(dfs[i] >= dfs[i + 1] for i in range(len(dfs) - 1))
                  and len(set(dfs)) >= 5)
            dp.unlink(missing_ok=True)

            RESULTS["ok"] = all(v is True for v in RESULTS.values())
        except Exception as e:
            RESULTS["error"] = str(e)
            RESULTS["ok"] = False
        OUT.write_text(json.dumps(RESULTS, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            window.destroy()
        except Exception:
            pass

    webview.start(debug=False, private_mode=True, func=worker)


if __name__ == "__main__":
    main_test()
