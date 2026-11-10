import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "app"))

import webview

OUT = Path(__file__).resolve().parent / "selftest-result.json"


def main_test():
    window = webview.create_window(
        "selftest",
        url=str(ROOT / "app" / "web" / "index.html") + "?selftest=1",
        width=1100,
        height=760,
    )

    def worker():
        try:
            for _ in range(60):
                time.sleep(0.5)
                title = window.evaluate_js("document.title") or ""
                if title.startswith("SELFTEST:"):
                    break
            res = window.evaluate_js("JSON.stringify(window.__SELFTEST__ || {})")
            data = json.loads(res) if res else {}
        except Exception as e:
            data = {"error": str(e), "total": False}
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            window.destroy()
        except Exception:
            pass

    webview.start(debug=False, private_mode=True, func=worker)


if __name__ == "__main__":
    main_test()
