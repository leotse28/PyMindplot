from __future__ import annotations

import base64
import ctypes
import io
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

import webview

APP_NAME = "PyMindplot"
APP_VERSION = "1.23.0"
CONFIG_FILENAME = "app.config.json"
FILE_TYPES = ("思维导图 (*.mm;*.xml;*.xmind)", "所有文件 (*.*)")
ALL_FILE_TYPES = ("所有文件 (*.*)", "所有文件 (*.*)")
LAYOUTS = ("map-balance", "map-right", "org-down", "tree-right", "timeline", "fishbone")

MARKER_EMOJI = {
    "priority-1": "➊", "priority-2": "➋", "priority-3": "➌",
    "priority-4": "➍", "priority-5": "➎", "priority-6": "➏",
    "star-red": "⭐", "star-yellow": "⭐",
    "flag-red": "🚩", "flag-orange": "🚩",
    "task-done": "✅", "task-start": "🚀",
}

STARTUP_FILE: Optional[str] = None

_WINDOW: Optional["webview.Window"] = None


def resource_base() -> Path:
    if getattr(sys, "frozen", False):
        return Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    return Path(__file__).resolve().parent


def web_root() -> Path:
    return resource_base() / "web"


def config_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def config_path() -> Path:
    return config_dir() / CONFIG_FILENAME


DEFAULT_CONFIG: Dict[str, Any] = {
    "lastFile": "",
    "width": 1280,
    "height": 840,
}


def load_config() -> Dict[str, Any]:
    cfg = dict(DEFAULT_CONFIG)
    try:
        p = config_path()
        if p.exists():
            with p.open("r", encoding="utf-8-sig") as f:
                data = json.load(f)
            if isinstance(data, dict):
                cfg.update(data)
    except Exception:
        pass
    return cfg


def save_config(cfg: Dict[str, Any]) -> None:
    try:
        p = config_path()
        tmp = p.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        os.replace(tmp, p)
    except Exception:
        pass


def _clean_color(v: Any) -> str:
    s = str(v or "").strip()
    if not s:
        return ""
    if not s.startswith("#"):
        return ""
    return s.upper()


def _node_text(el: ET.Element) -> str:
    t = el.get("TEXT", "")
    if t:
        return t
    for rc in el.findall("richcontent"):
        if rc.get("TYPE", "NODE") in ("NODE", "DETAILS"):
            txt = "".join(rc.itertext()).strip()
            if txt:
                return txt
    return ""


def _encode_attachments(attach: Any) -> Optional[str]:
    if not isinstance(attach, list) or not attach:
        return None
    items = []
    for a in attach:
        if not isinstance(a, dict):
            continue
        name = str(a.get("name", "")).strip()
        rel = str(a.get("rel", "")).strip()
        data = str(a.get("data", "")).strip()
        if name and data:
            items.append({"name": name, "data": data})
        elif name and rel:
            items.append({"name": name, "rel": rel})
    if not items:
        return None
    raw = json.dumps(items, ensure_ascii=False).encode("utf-8")
    return base64.b64encode(raw).decode("ascii")


def _decode_attachments(v: Any) -> List[Dict[str, str]]:
    try:
        items = json.loads(base64.b64decode(str(v)).decode("utf-8"))
        out = []
        for a in items if isinstance(items, list) else []:
            if not isinstance(a, dict) or not a.get("name"):
                continue
            entry = {"name": str(a["name"])}
            if a.get("data"):
                entry["data"] = str(a["data"])
            if a.get("rel"):
                entry["rel"] = str(a["rel"])
            if entry.get("data") or entry.get("rel"):
                out.append(entry)
        return out
    except Exception:
        return []


def _pos_num(v: Any) -> float:
    try:
        f = float(str(v).strip())
        return f if f > 0 else 0
    except Exception:
        return 0


def parse_node(el: ET.Element) -> Dict[str, Any]:
    node: Dict[str, Any] = {
        "text": _node_text(el),
        "children": [],
        "collapsed": el.get("FOLDED", "").strip().lower() == "true",
        "color": _clean_color(el.get("COLOR")),
        "bg": _clean_color(el.get("BACKGROUND_COLOR")),
        "bold": False,
        "fs": 0,
        "it": False,
        "ul": el.get("UNDERLINE", "").strip().lower() == "true",
        "latex": str(el.get("LATEX") or ""),
        "img": str(el.get("IMAGE") or ""),
        "imgdata": str(el.get("IMGDATA") or ""),
        "w": _pos_num(el.get("WIDTH")),
        "h": _pos_num(el.get("HEIGHT")),
        "attach": _decode_attachments(el.get("ATTACHMENTS")),
    }
    for f in el.findall("font"):
        try:
            sz = int(str(f.get("SIZE") or "0"))
        except ValueError:
            sz = 0
        if sz > 12:
            node["fs"] = sz
        if f.get("BOLD", "").strip().lower() == "true":
            node["bold"] = True
        if f.get("ITALIC", "").strip().lower() == "true":
            node["it"] = True
    for child in el.findall("node"):
        node["children"].append(parse_node(child))
    return node


def parse_map_bytes(data: bytes) -> Dict[str, Any]:
    root_el = ET.fromstring(data)
    layout = ""
    theme = ""
    if root_el.tag == "map":
        first = root_el.find("node")
        if first is None:
            raise ValueError("map 元素下没有 node 节点")
        root = parse_node(first)
        layout = str(root_el.get("layout") or "").strip()
        theme = str(root_el.get("theme") or "").strip()
    elif root_el.tag == "node":
        root = parse_node(root_el)
    else:
        raise ValueError(f"无法识别的根元素: <{root_el.tag}>")
    return {
        "root": root,
        "layout": layout if layout in LAYOUTS else "",
        "theme": theme[:24],
    }


def build_node_el(node: Dict[str, Any]) -> ET.Element:
    attrib: Dict[str, str] = {}
    text = str(node.get("text", "") or "")
    attrib["TEXT"] = text
    if _clean_color(node.get("color")):
        attrib["COLOR"] = _clean_color(node.get("color"))
    if _clean_color(node.get("bg")):
        attrib["BACKGROUND_COLOR"] = _clean_color(node.get("bg"))
    if node.get("collapsed"):
        attrib["FOLDED"] = "true"
    if _pos_num(node.get("w")) > 0:
        attrib["WIDTH"] = str(int(round(_pos_num(node.get("w")))))
    if _pos_num(node.get("h")) > 0:
        attrib["HEIGHT"] = str(int(round(_pos_num(node.get("h")))))
    if node.get("ul"):
        attrib["UNDERLINE"] = "true"
    latex = str(node.get("latex") or "").strip()
    if latex:
        attrib["LATEX"] = latex
    img = str(node.get("img") or "").strip()
    if img:
        attrib["IMAGE"] = img
    imgdata = str(node.get("imgdata") or "").strip()
    if imgdata:
        attrib["IMGDATA"] = imgdata
    enc = _encode_attachments(node.get("attach"))
    if enc:
        attrib["ATTACHMENTS"] = enc
    font_attrs: Dict[str, str] = {}
    if node.get("bold"):
        font_attrs["BOLD"] = "true"
    if _pos_num(node.get("fs")) > 12:
        font_attrs["SIZE"] = str(int(_pos_num(node.get("fs"))))
    if node.get("it"):
        font_attrs["ITALIC"] = "true"
    el = ET.Element("node", attrib)
    if font_attrs:
        font_attrs.setdefault("NAME", "SansSerif")
        ET.SubElement(el, "font", font_attrs)
    for child in node.get("children", []) or []:
        if isinstance(child, dict):
            el.append(build_node_el(child))
    return el


def serialize_mm(root: Dict[str, Any], layout: str = "", theme: str = "") -> bytes:
    if not isinstance(root, dict):
        raise ValueError("root 必须是节点对象")
    attrib = {"version": "1.0.1"}
    if layout in LAYOUTS:
        attrib["layout"] = layout
    if theme:
        attrib["theme"] = str(theme)[:24]
    map_el = ET.Element("map", attrib)
    map_el.append(build_node_el(root))
    ET.indent(map_el, space="  ")
    return ET.tostring(map_el, encoding="UTF-8", xml_declaration=True)


def normalize_map_path(path: str) -> str:
    p = str(path or "").strip()
    if not p.lower().endswith((".mm", ".xml")):
        p += ".mm"
    return p


def sidecar_dir(map_path: str) -> Path:
    return Path(str(map_path)).with_suffix(".assets")


def add_attachment_file(map_path: str, src_file: str) -> Dict[str, Any]:
    try:
        mp = Path(str(map_path))
        if not mp.exists():
            return {"ok": False, "error": "请先保存导图后再插入附件"}
        src = Path(str(src_file))
        if not src.exists() or not src.is_file():
            return {"ok": False, "error": "源文件不存在"}
        raw = src.read_bytes()
        data = base64.b64encode(raw).decode("ascii")
        return {"ok": True, "name": src.name, "data": data}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def add_attachment_data_file(map_path: str, name: str, data_b64: str) -> Dict[str, Any]:
    try:
        mp = Path(str(map_path))
        if not mp.exists():
            return {"ok": False, "error": "请先保存导图后再插入附件"}
        safe = Path(str(name)).name or "附件"
        raw = base64.b64decode(str(data_b64)) if data_b64 else b""
        if not raw:
            return {"ok": False, "error": "文件内容为空"}
        return {"ok": True, "name": safe, "data": str(data_b64)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def save_attachment_file(map_path: str, entry: Any, dest: str) -> Dict[str, Any]:
    try:
        if isinstance(entry, str):
            entry = {"rel": entry}
        if not isinstance(entry, dict):
            return {"ok": False, "error": "无效的附件数据"}
        raw = None
        if entry.get("data"):
            raw = base64.b64decode(str(entry["data"]))
        elif entry.get("rel"):
            p = sidecar_dir(map_path) / Path(str(entry["rel"])).name
            if not p.exists():
                return {"ok": False, "error": "附件文件不存在（.assets 文件夹可能被移动或删除）"}
            raw = p.read_bytes()
        else:
            return {"ok": False, "error": "附件数据缺失"}
        destp = Path(str(dest))
        if not destp.name:
            return {"ok": False, "error": "无效的保存路径"}
        if destp.exists():
            return {"ok": False, "error": "目标文件已存在"}
        destp.parent.mkdir(parents=True, exist_ok=True)
        destp.write_bytes(raw)
        return {"ok": True, "path": str(destp)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def extract_attachment_file(map_path: str, entry: Any) -> Dict[str, Any]:
    try:
        if isinstance(entry, str):
            entry = {"rel": entry}
        if not isinstance(entry, dict):
            return {"ok": False, "error": "无效的附件数据"}
        name = Path(str(entry.get("name") or "附件")).name or "附件"
        raw = None
        if entry.get("data"):
            raw = base64.b64decode(str(entry["data"]))
        elif entry.get("rel"):
            p = sidecar_dir(map_path) / Path(str(entry["rel"])).name
            if not p.exists():
                return {"ok": False, "error": "附件文件不存在（.assets 文件夹可能被移动或删除）"}
            raw = p.read_bytes()
        else:
            return {"ok": False, "error": "附件数据缺失"}
        if raw is None:
            return {"ok": False, "error": "附件数据缺失"}
        out_dir = Path(tempfile.gettempdir()) / "PyMindplot_附件"
        out_dir.mkdir(exist_ok=True)
        target = out_dir / name
        stem, ext = target.stem, target.suffix
        i = 1
        while target.exists():
            target = out_dir / f"{stem}({i}){ext}"
            i += 1
        target.write_bytes(raw)
        return {"ok": True, "path": str(target), "name": target.name}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def open_attachment_file(map_path: str, entry: Any) -> Dict[str, Any]:
    res = extract_attachment_file(map_path, entry)
    if not res.get("ok"):
        return res
    try:
        os.startfile(res["path"])
        return {"ok": True, "path": res["path"]}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def add_image_file(map_path: str, data_b64: str, ext: str = "png") -> Dict[str, Any]:
    try:
        mp = Path(str(map_path))
        if not mp.exists():
            return {"ok": False, "error": "请先保存导图后再粘贴图片"}
        raw = base64.b64decode(str(data_b64))
        if not raw:
            return {"ok": False, "error": "图片数据为空"}
        ext = re.sub(r"[^a-z0-9]", "", str(ext).lower()) or "png"
        data = base64.b64encode(raw).decode("ascii")
        return {"ok": True, "name": f"粘贴图片.{ext}", "data": data}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def read_image_data(map_path: str, rel: str) -> Dict[str, Any]:
    try:
        safe = Path(str(rel)).name
        if not safe:
            return {"ok": False, "error": "无效的图片路径"}
        p = sidecar_dir(map_path) / safe
        if not p.exists():
            return {"ok": False, "error": "图片文件不存在"}
        ext = p.suffix.lower().lstrip(".")
        mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp",
                "svg": "image/svg+xml"}.get(ext, "application/octet-stream")
        return {"ok": True, "data": base64.b64encode(p.read_bytes()).decode("ascii"), "mime": mime}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def save_png_file(map_path: str, data_b64: str) -> Dict[str, Any]:
    try:
        mp = Path(str(map_path))
        if not mp.exists():
            return {"ok": False, "error": "请先保存导图后再导出 PNG"}
        raw = base64.b64decode(str(data_b64))
        if not raw:
            return {"ok": False, "error": "PNG 数据为空"}
        if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
            return {"ok": False, "error": "数据不是有效的 PNG 图片"}
        target = mp.with_suffix(".png")
        target.write_bytes(raw)
        return {"ok": True, "name": target.name, "path": str(target)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _base_node(text: str) -> Dict[str, Any]:
    return {
        "text": text,
        "children": [],
        "collapsed": False,
        "color": "",
        "bg": "",
        "bold": False,
        "fs": 0,
        "it": False,
        "ul": False,
        "latex": "",
        "img": "",
        "imgdata": "",
        "w": 0,
        "h": 0,
        "attach": [],
    }


def _marker_ids_from_json(markers: Any) -> List[str]:
    ids: List[str] = []
    if isinstance(markers, dict):
        for v in markers.values():
            if isinstance(v, str):
                ids.append(v)
            elif isinstance(v, dict) and v.get("markerId"):
                ids.append(str(v["markerId"]))
    elif isinstance(markers, list):
        for m in markers:
            if isinstance(m, dict) and m.get("markerId"):
                ids.append(str(m["markerId"]))
    return ids


def _strip_html(html: str) -> str:
    return re.sub(r"<[^>]+>", "", str(html)).strip()


def _compose_text(title: str, notes: str, labels: List[str], marker_ids: List[str]) -> str:
    seen: List[str] = []
    for mid in marker_ids:
        if mid and mid not in seen:
            seen.append(mid)
    prefix = "".join(MARKER_EMOJI.get(mid, "") for mid in seen if mid in MARKER_EMOJI)
    text = (prefix + " " + title).strip() if prefix else title
    if notes:
        text += "\n[备注] " + notes
    if labels:
        text += "\n[标签] " + "、".join(labels)
    return text


def _xmind_json_topic(t: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(t, dict):
        return None
    title = str(t.get("title") or "").strip()
    notes = ""
    notes_obj = t.get("notes")
    if isinstance(notes_obj, dict):
        plain = notes_obj.get("plain")
        if isinstance(plain, dict) and plain.get("content"):
            notes = str(plain["content"]).strip()
        elif notes_obj.get("realHTML"):
            notes = _strip_html(str(notes_obj["realHTML"]))
    labels = [str(x) for x in (t.get("labels") or []) if str(x).strip()]
    marker_ids = _marker_ids_from_json(t.get("markers"))
    node = _base_node(_compose_text(title, notes, labels, marker_ids))
    children = t.get("children")
    if isinstance(children, dict):
        for key in ("attached", "detached"):
            for c in children.get(key) or []:
                cn = _xmind_json_topic(c)
                if cn:
                    node["children"].append(cn)
    return node


def _xmind_local(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def _xmind_find(el: ET.Element, name: str) -> Optional[ET.Element]:
    for c in el:
        if _xmind_local(c) == name:
            return c
    return None


def _xmind_all(el: ET.Element, name: str) -> List[ET.Element]:
    return [c for c in el if _xmind_local(c) == name]


def _xmind_xml_topic(el: ET.Element) -> Dict[str, Any]:
    title_el = _xmind_find(el, "title")
    title = "".join(title_el.itertext()).strip() if title_el is not None else ""
    notes = ""
    notes_el = _xmind_find(el, "notes")
    if notes_el is not None:
        plain_el = _xmind_find(notes_el, "plain")
        if plain_el is not None:
            notes = "".join(plain_el.itertext()).strip()
        else:
            html_el = _xmind_find(notes_el, "html")
            if html_el is not None:
                notes = _strip_html("".join(html_el.itertext()))
    labels_el = _xmind_find(el, "labels")
    labels = ["".join(l.itertext()).strip() for l in _xmind_all(labels_el, "label")] if labels_el is not None else []
    labels = [x for x in labels if x]
    marker_ids: List[str] = []
    refs_el = _xmind_find(el, "marker-refs")
    if refs_el is not None:
        for m in _xmind_all(refs_el, "marker-ref"):
            mid = m.get("marker-id") or m.get("markerId")
            if mid:
                marker_ids.append(str(mid))
    node = _base_node(_compose_text(title, notes, labels, marker_ids))
    children_el = _xmind_find(el, "children")
    if children_el is not None:
        for topics in _xmind_all(children_el, "topics"):
            ttype = (topics.get("type") or "attached").strip().lower()
            if ttype in ("attached", "detached"):
                for t in _xmind_all(topics, "topic"):
                    node["children"].append(_xmind_xml_topic(t))
    return node


def parse_xmind_bytes(data: bytes) -> Dict[str, Any]:
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("文件已损坏或不是有效的 .xmind 压缩包")
    names = zf.namelist()
    root: Optional[Dict[str, Any]] = None
    if "content.json" in names:
        try:
            sheets = json.loads(zf.read("content.json").decode("utf-8-sig"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ValueError(f"content.json 解析失败：{e}")
        if isinstance(sheets, dict):
            sheets = [sheets]
        if not isinstance(sheets, list) or not sheets:
            raise ValueError("content.json 中没有工作表（sheet）")
        sheet = sheets[0]
        rt = sheet.get("rootTopic") if isinstance(sheet, dict) else None
        root = _xmind_json_topic(rt)
        if root is None:
            raise ValueError("content.json 中没有 rootTopic（根主题）")
    elif "content.xml" in names:
        try:
            xml_el = ET.fromstring(zf.read("content.xml"))
        except ET.ParseError as e:
            raise ValueError(f"content.xml 解析失败：{e}")
        tag = _xmind_local(xml_el)
        sheet_el = xml_el if tag == "sheet" else None
        if sheet_el is None:
            for c in xml_el.iter():
                if _xmind_local(c) == "sheet":
                    sheet_el = c
                    break
        if sheet_el is None:
            raise ValueError("content.xml 中没有工作表（sheet）")
        topic_el = _xmind_find(sheet_el, "topic")
        if topic_el is None:
            raise ValueError("content.xml 中没有根主题（topic）")
        root = _xmind_xml_topic(topic_el)
    else:
        raise ValueError("不是有效的 .xmind 文件（缺少 content.json / content.xml）")
    return {"root": root, "layout": "", "theme": ""}


def load_map_file(path: str) -> Dict[str, Any]:
    try:
        p = Path(str(path))
        data = p.read_bytes()
        if p.suffix.lower() == ".xmind":
            parsed = parse_xmind_bytes(data)
            fmt = "xmind"
        else:
            parsed = parse_map_bytes(data)
            fmt = p.suffix.lower().lstrip(".")
        return {
            "ok": True,
            "path": str(p.resolve()),
            "name": p.name,
            "format": fmt,
            "root": parsed["root"],
            "layout": parsed["layout"],
            "theme": parsed["theme"],
        }
    except Exception as e:
        return {"ok": False, "error": str(e), "path": str(path)}


def save_map_file(path: str, payload: Any) -> Dict[str, Any]:
    try:
        raw = Path(str(path))
        if raw.suffix.lower() == ".xmind":
            return {
                "ok": False,
                "error": "不支持保存为 .xmind 格式，请另存为 .mm 或 .xml",
                "path": str(raw),
            }
        target = Path(normalize_map_path(path))
        layout = ""
        theme = ""
        if isinstance(payload, dict) and isinstance(payload.get("root"), dict):
            root = payload["root"]
            layout = str(payload.get("layout") or "")
            theme = str(payload.get("theme") or "")
        elif isinstance(payload, dict):
            root = payload
        else:
            return {"ok": False, "error": "缺少 root 节点", "path": str(target)}
        data = serialize_mm(root, layout, theme)
        tmp = target.with_suffix(target.suffix + ".tmp")
        tmp.write_bytes(data)
        os.replace(tmp, target)
        return {"ok": True, "path": str(target), "bytes": len(data)}
    except Exception as e:
        return {"ok": False, "error": str(e), "path": str(path)}


class Api:
    def __init__(self) -> None:
        self.cfg = load_config()
        self._startup_file: Optional[str] = None
        self._lock = threading.Lock()
        self._dirty = False

    def set_dirty(self, v: Any) -> Dict[str, Any]:
        """JS 侧修改状态同步（未保存修改时退出需要拦截确认）。"""
        self._dirty = bool(v)
        return {"ok": True, "dirty": self._dirty}

    def get_config(self) -> Dict[str, Any]:
        return self.cfg

    def set_config(self, patch: Dict[str, Any]) -> Dict[str, Any]:
        if isinstance(patch, dict):
            self.cfg.update(patch)
            save_config(self.cfg)
        return self.cfg

    def get_version(self) -> Dict[str, str]:
        return {"name": APP_NAME, "version": APP_VERSION}

    def take_startup_file(self) -> Optional[str]:
        with self._lock:
            path, self._startup_file = self._startup_file, None
        return path

    def pick_open_file(self) -> Optional[str]:
        if not _WINDOW:
            return None
        res = _WINDOW.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=False, file_types=FILE_TYPES
        )
        if not res:
            return None
        if isinstance(res, (list, tuple)):
            return res[0] if res else None
        return str(res)

    def get_save_path(self, default_name: str = "") -> Optional[str]:
        if not _WINDOW:
            return None
        res = _WINDOW.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=str(default_name or "未命名.mm"),
            file_types=FILE_TYPES,
        )
        if not res:
            return None
        if isinstance(res, (list, tuple)):
            res = res[0] if res else None
            if not res:
                return None
        return normalize_map_path(str(res))

    def get_save_path_any(self, default_name: str = "") -> Optional[str]:
        if not _WINDOW:
            return None
        res = _WINDOW.create_file_dialog(
            webview.SAVE_DIALOG,
            save_filename=str(default_name or "附件"),
            file_types=ALL_FILE_TYPES,
        )
        if not res:
            return None
        if isinstance(res, (list, tuple)):
            res = res[0] if res else None
            if not res:
                return None
        return str(res)

    def save_attachment_as(self, map_path: str, entry: Dict[str, Any], dest: str) -> Dict[str, Any]:
        return save_attachment_file(map_path, entry, dest)

    def add_attachment_data(self, map_path: str, name: str, data_b64: str) -> Dict[str, Any]:
        return add_attachment_data_file(map_path, name, data_b64)

    def load_map(self, path: str) -> Dict[str, Any]:
        return load_map_file(path)

    def save_map(self, path: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        return save_map_file(path, payload)

    def add_attachment(self, map_path: str, src_file: str) -> Dict[str, Any]:
        return add_attachment_file(map_path, src_file)

    def open_attachment(self, map_path: str, rel: str) -> Dict[str, Any]:
        return open_attachment_file(map_path, rel)

    def add_image(self, map_path: str, data_b64: str, ext: str = "png") -> Dict[str, Any]:
        return add_image_file(map_path, data_b64, ext)

    def read_image_data(self, map_path: str, rel: str) -> Dict[str, Any]:
        return read_image_data(map_path, rel)

    def save_png(self, map_path: str, data_b64: str) -> Dict[str, Any]:
        return save_png_file(map_path, data_b64)

    def pick_attachment_file(self) -> Optional[str]:
        if not _WINDOW:
            return None
        res = _WINDOW.create_file_dialog(
            webview.OPEN_DIALOG, allow_multiple=False, file_types=("所有文件 (*.*)",)
        )
        if not res:
            return None
        if isinstance(res, (list, tuple)):
            return res[0] if res else None
        return str(res)

    def report_selftest(self, results: Dict[str, Any]) -> bool:
        try:
            (config_dir() / "selftest-result.json").write_text(
                json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except Exception:
            return False
        return True


def parse_startup_arg(argv: List[str]) -> Optional[str]:
    for arg in argv[1:]:
        if arg.startswith("-"):
            continue
        try:
            p = Path(arg.strip('"'))
            if p.exists():
                return str(p.resolve())
        except Exception:
            continue
    return None


def main() -> None:
    global STARTUP_FILE
    selftest = "--selftest" in sys.argv
    STARTUP_FILE = None if selftest else parse_startup_arg(sys.argv)

    cfg = load_config()
    index = web_root() / "index.html"
    if not index.exists():
        raise SystemExit(f"UI not found: {index}")

    index_url = index.as_uri() + "#selftest=1" if selftest else str(index)

    api = Api()
    api.cfg = cfg
    global _WINDOW
    api._startup_file = STARTUP_FILE

    window = webview.create_window(
        APP_NAME,
        url=index_url,
        js_api=api,
        width=int(cfg.get("width", 1280)),
        height=int(cfg.get("height", 840)),
        min_size=(760, 540),
        background_color="#f4f6fb",
        text_select=False,
    )
    _WINDOW = window

    def _on_closing() -> bool:
        """返回 False 取消关闭：有未保存修改时弹原生确认框。"""
        if selftest or not api._dirty:
            return True
        MB_OKCANCEL = 0x00000000
        MB_ICONWARNING = 0x00000030
        IDOK = 1
        try:
            res = ctypes.windll.user32.MessageBoxW(
                0,
                "当前导图有未保存的修改（可能包含未保存的附件关联）。\n"
                "退出将丢失这些修改，建议先 Ctrl+S 保存。\n\n确定要退出吗？",
                APP_NAME,
                MB_OKCANCEL | MB_ICONWARNING,
            )
        except Exception:
            res = IDOK
        return res == IDOK

    window.events.closing += _on_closing

    def _selftest_worker() -> None:
        out = config_dir() / "selftest-result.json"
        for _ in range(100):
            time.sleep(0.15)
            try:
                raw = window.evaluate_js(
                    "(window.__SELFTEST__ ? JSON.stringify(window.__SELFTEST__) : '')"
                )
            except Exception:
                raw = None
            if raw:
                try:
                    out.write_text(raw, encoding="utf-8")
                except Exception:
                    pass
                try:
                    window.destroy()
                except Exception:
                    pass
                return
        try:
            out.write_text('{"error":"selftest timeout","total":false}', encoding="utf-8")
        except Exception:
            pass
        try:
            window.destroy()
        except Exception:
            pass

    try:
        webview.start(
            debug=False,
            private_mode=True,
            func=_selftest_worker if selftest else None,
        )
    finally:
        if not selftest:
            try:
                api.cfg["width"], api.cfg["height"] = window.width, window.height
            except Exception:
                pass
            save_config(api.cfg)


if __name__ == "__main__":
    main()
