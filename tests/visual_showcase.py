import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import webview

import main


def main_showcase():
    api = main.Api()
    # 用临时副本展示，避免场景操作（自动保存等）污染 samples 原件
    tmp_dir = tempfile.mkdtemp(prefix="mm_showcase_")
    tmp_sample = Path(tmp_dir) / "showcase.mm"
    shutil.copyfile(ROOT / "samples" / "sample.mm", tmp_sample)
    window = webview.create_window(
        "showcase",
        url=str(ROOT / "app" / "web" / "index.html"),
        js_api=api,
        width=1280,
        height=840,
    )

    def worker():
        log_path = Path(__file__).resolve().parent / "showcase-state.log"
        try:
            doc = main.load_map_file(str(tmp_sample))
            doc["layout"] = sys.argv[1] if len(sys.argv) > 1 else "fishbone"
            doc["theme"] = sys.argv[2] if len(sys.argv) > 2 else "dark"
            window.evaluate_js("window.__MM__.loadDoc(" + json.dumps(doc, ensure_ascii=False) + ")")
            time.sleep(0.6)
            window.evaluate_js("window.__MM__.fitView()")
            if len(sys.argv) > 3 and sys.argv[3] == "ctx":
                window.evaluate_js(
                    "(() => { const M = window.__MM__;"
                    " const n = M.state.root.children[1];"
                    " n.attach = [{ name: '航空复杂产品系统工程：需求分析与架构设计.pdf', rel: 'demo.pdf' }];"
                    " M.select(n.id); M.render();"
                    " const el = M.MMRender.getNodeEl(n.id);"
                    " const r = el.getBoundingClientRect();"
                    " M.openCtxMenu(Math.round(r.right) - 60, Math.round(r.bottom) + 14); })()"
                )
            if len(sys.argv) > 3 and sys.argv[3] == "edit":
                window.evaluate_js(
                    "(() => { const M = window.__MM__;"
                    " M.select(M.state.root.id); M.render();"
                    " M.startEdit(M.state.root.id, true);"
                    " const inp = document.querySelector('.mm-edit-input');"
                    " inp.value = '15';"
                    " inp.dispatchEvent(new Event('input', {bubbles: true})); })()"
                )
            if len(sys.argv) > 3 and sys.argv[3] == "tabs":
                window.evaluate_js(
                    "(() => { const M = window.__MM__;"
                    " M.addTab();"
                    " M.addChild(M.state.root.id, {edit: false});"
                    " M.setNodeText(M.state.root.children[0].id, '供应链调研');"
                    " M.commitEdit(false);"
                    " M.addTab();"
                    " M.addChild(M.state.root.id, {edit: false});"
                    " M.setNodeText(M.state.root.children[0].id, '工艺路线');"
                    " M.commitEdit(false);"
                    " M.switchTab(0);"
                    " const n = M.state.root.children[1];"
                    " if (n) { n.attach = [{ name: '规格书.pdf', rel: 'demo.pdf' }]; M.select(n.id); M.render(); } })()"
                )
            if len(sys.argv) > 3 and sys.argv[3] == "size":
                window.evaluate_js(
                    "(() => { const M = window.__MM__;"
                    " const kids = M.state.root.children;"
                    " M.setNodeSize(M.state.root.id, 260, 90);"
                    " M.setNodeSize(kids[0].id, 220, 64);"
                    " M.setNodeSize(kids[1].id, 150, 40);"
                    " const ln = M.MMModel.createNode('超长文本节点用于验证手动调整尺寸后文字自动换行并且连线端点始终跟随格子边界');"
                    " kids[2].children.push(ln);"
                    " if (kids[2].collapsed) kids[2].collapsed = false;"
                    " M.state.sel = kids[0].id;"
                    " M.render();"
                    " M.optimizeSizes();"
                    " M.setNodeSize(M.state.root.id, 260, 90);"
                    " M.setNodeSize(kids[0].id, 220, 64);"
                    " M.fitView(); })()"
                )
        except Exception as e:
            with log_path.open("a", encoding="utf-8") as f:
                f.write("ERR " + repr(e) + "\n")
        for i in range(12):
            time.sleep(1)
            try:
                st = window.evaluate_js(
                    "JSON.stringify({z: window.__MM__.state.zoom,"
                    " px: Math.round(window.__MM__.state.pan.x), py: Math.round(window.__MM__.state.pan.y),"
                    " vp: document.getElementById('viewport').style.transform,"
                    " root: (() => { const el = document.querySelector('.mm-node.root');"
                    " if (!el) return null; const r = el.getBoundingClientRect();"
                    " const c = document.getElementById('canvas').getBoundingClientRect();"
                    " return {x: Math.round(r.x - c.x), y: Math.round(r.y - c.y), w: Math.round(r.width)};})(),"
                    " cw: document.getElementById('canvas').clientWidth,"
                    " ch: document.getElementById('canvas').clientHeight})"
                )
                with log_path.open("a", encoding="utf-8") as f:
                    f.write(str(i) + " " + str(st) + "\n")
            except Exception as e:
                with log_path.open("a", encoding="utf-8") as f:
                    f.write("ERR " + repr(e) + "\n")
        try:
            window.destroy()
        except Exception:
            pass

    webview.start(debug=False, private_mode=True, func=worker)


if __name__ == "__main__":
    main_showcase()
