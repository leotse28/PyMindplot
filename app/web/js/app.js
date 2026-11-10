(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const api = () => {
    const a = window.pywebview && window.pywebview.api;
    return a && typeof a.save_map === 'function' ? a : null;
  };

  const canvas = $('canvas');
  const viewport = $('viewport');
  const nodesLayer = $('nodes');
  const sidebar = $('sidebar');
  const bgBox = $('bg-swatches');
  const fgBox = $('fg-swatches');
  const chkBold = $('chk-bold');
  const chkItalic = $('chk-italic');
  const chkUnderline = $('chk-underline');
  const selFontsize = $('sel-fontsize');
  const inpLatex = $('inp-latex');
  const stFile = $('st-file');
  const stModified = $('st-modified');
  const stCount = $('st-count');
  const stZoom = $('st-zoom');
  const tbTitle = $('tb-title');
  const toastEl = $('toast');
  const modalEl = $('modal');
  const modalText = $('modal-text');
  const emptyHint = $('empty-hint');

  const state = {
    root: null,
    path: '',
    name: '',
    format: '',
    modified: false,
    sel: null,
    editing: false,
    layout: 'map-balance',
    theme: 'default',
    pan: { x: 0, y: 0 },
    zoom: 1,
    undo: [],
    redo: [],
    pos: new Map(),
    sides: new Map(),
    sizes: new Map(),
    multiSel: new Set(),
    trackMode: false,
    trackRange: 65,
    trackZoom: 1.5,
    trackFade: new Map(),
    trackOp: new Map(),
    trackZone: null,
    trackNavAnchor: null,
    trackNavKey: '',
    trackNavIdx: 0,
    trackNavCands: [],
    startupConsumed: false
  };

  let editCtx = null;
  let drag = null;
  let panDrag = null;
  let toastTimer = null;
  let modalResolve = null;

  const tabs = [];
  let activeTab = 0;
  let tabSeq = 0;
  const TAB_FIELDS = ['root', 'path', 'name', 'format', 'layout', 'theme', 'sel', 'pan', 'zoom', 'undo', 'redo', 'pos', 'sides', 'sizes'];

  function tabTitle(t, live) {
    const nm = live ? (state.name || '未命名') : (t.name || '未命名');
    const mod = live ? state.modified : !!t.modified;
    return (mod ? '\u25cf ' : '') + nm;
  }

  function renderTabs() {
    const bar = $('tabbar');
    if (!bar) return;
    bar.textContent = '';
    tabs.forEach((t, i) => {
      const el = document.createElement('div');
      el.className = 'tab' + (i === activeTab ? ' active' : '');
      el.dataset.idx = String(i);
      const label = document.createElement('span');
      label.className = 'tab-label';
      label.textContent = tabTitle(t, i === activeTab);
      label.title = (t.path || '未命名（尚未保存）') + (i === activeTab && state.modified ? '（未保存）' : '');
      const close = document.createElement('span');
      close.className = 'tab-close';
      close.textContent = '\u00d7';
      close.title = '关闭标签页 (Ctrl+W)';
      close.addEventListener('click', (e) => { e.stopPropagation(); closeTab(i); });
      el.appendChild(label);
      el.appendChild(close);
      el.addEventListener('click', () => switchTab(i));
      el.addEventListener('auxclick', (e) => { if (e.button === 1) closeTab(i); });
      bar.appendChild(el);
    });
    const plus = document.createElement('button');
    plus.className = 'tab-new';
    plus.id = 'tab-new';
    plus.textContent = '+';
    plus.title = '新建标签页 (Ctrl+T)';
    plus.addEventListener('click', addTab);
    bar.appendChild(plus);
  }

  const BG_COLORS = ['', '#e8f0fe', '#fce8e6', '#fef7e0', '#e6f4ea', '#f3e8fd', '#e0f7fa', '#fff3e0', '#2f6fed', '#22a55a', '#e05252', '#fbbc05'];
  const FG_COLORS = ['', '#2b3245', '#c0392b', '#1565c0', '#1e8e3e', '#9334e6', '#b85c00', '#ffffff'];

  function setDirty(v) {
    const flag = !!v;
    if (setDirty._last === flag) return;
    setDirty._last = flag;
    const A = api();
    if (A && A.set_dirty) {
      try { A.set_dirty(flag); } catch (err) { /* 桥接未就绪时忽略 */ }
    }
  }

  function pushUndo() {
    state.undo.push(JSON.stringify(MMModel.cleanTree(state.root)));
    if (state.undo.length > 200) state.undo.shift();
    state.redo.length = 0;
    state.modified = true;
    setDirty(true);
  }

  function restoreSnap(snap) {
    state.root = JSON.parse(snap);
    if (!state.root.id) MMModel.assignIds(state.root);
    if (!MMModel.findNode(state.root, state.sel)) state.sel = state.root.id;
    render();
  }

  function undo() {
    if (!state.undo.length) { toast('没有可撤销的操作'); return; }
    state.redo.push(JSON.stringify(MMModel.cleanTree(state.root)));
    restoreSnap(state.undo.pop());
  }

  function redo() {
    if (!state.redo.length) { toast('没有可重做的操作'); return; }
    state.undo.push(JSON.stringify(MMModel.cleanTree(state.root)));
    restoreSnap(state.redo.pop());
  }

  function render() {
    if (!state.root) return;
    computeTrackState();
    MMRender.render(state);
    syncCutMark();
    updateChrome();
    computeTrackState();
    applyTrackStyles();
  }

  function isHiddenNode(n) {
    let p = MMModel.findParent(state.root, n.id);
    while (p) {
      if (p.collapsed) return true;
      p = MMModel.findParent(state.root, p.id);
    }
    return false;
  }

  function updateChrome() {
    stFile.textContent = state.path || '未命名（尚未保存）';
    stModified.classList.toggle('hidden', !state.modified);
    const cnt = MMModel.countNodes(state.root);
    stCount.textContent = cnt + ' 节点';
    const title = (state.modified ? '\u25cf ' : '') + (state.name || '未命名') + ' \u2014 PyMindplot';
    tbTitle.textContent = title;
    document.title = title;
    emptyHint.classList.toggle('hidden', cnt > 1);
    sidebar.classList.toggle('hidden', !state.sel);
    setDirty(state.modified || tabs.some((t, j) => j !== activeTab && t.modified));
    syncLayoutThemeSelects();
    if (state.sel) syncStylePanel();
    renderTabs();
    renderAttachPanel();
  }

  function applyTheme() {
    const th = MMRender.themeOf(state);
    canvas.style.backgroundColor = th.canvas;
    canvas.style.backgroundImage = 'radial-gradient(circle, ' + th.dot + ' 1px, transparent 1px)';
  }

  function setTheme(themeKey) {
    if (!MMRender.THEMES[themeKey]) return;
    if (state.theme === themeKey) return;
    state.theme = themeKey;
    state.modified = true;
    applyTheme();
    render();
  }

  function setLayout(mode) {
    if (MMLayout.LAYOUT_MODES.indexOf(mode) < 0) return;
    if (state.layout === mode) return;
    state.layout = mode;
    state.modified = true;
    render();
    centerView();
  }

  function syncLayoutThemeSelects() {
    const selL = $('sel-layout');
    const selT = $('sel-theme');
    if (selL && selL.value !== state.layout) selL.value = state.layout;
    if (selT && selT.value !== state.theme) selT.value = state.theme;
  }

  function select(id, keepNav) {
    state.sel = id;
    state.multiSel.clear();
    render();
    if (state.trackMode && id) centerOnNode(id, true);
    if (!keepNav) {
      state.trackNavAnchor = null;
      state.trackNavKey = '';
    }
  }

  function addChild(parentId, opts) {
    const parent = MMModel.findNode(state.root, parentId);
    if (!parent) return null;
    pushUndo();
    const n = MMModel.createNode('新节点');
    parent.children.push(n);
    if (parent.collapsed) parent.collapsed = false;
    state.sel = n.id;
    render();
    if (!opts || opts.edit !== false) startEdit(n.id, true);
    return n.id;
  }

  function addSibling(id) {
    const p = MMModel.findParent(state.root, id);
    if (!p) { addChild(state.root.id); return; }
    pushUndo();
    const idx = p.children.findIndex((c) => c.id === id);
    const n = MMModel.createNode('新节点');
    p.children.splice(idx + 1, 0, n);
    state.sel = n.id;
    render();
    startEdit(n.id, true);
  }

  function deleteNode(id) {
    if (!id || id === state.root.id) { toast('根节点不能删除'); return; }
    const p = MMModel.findParent(state.root, id);
    if (!p) return;
    pushUndo();
    const idx = p.children.findIndex((c) => c.id === id);
    p.children.splice(idx, 1);
    if (clip && clip.cutId && !MMModel.findNode(state.root, clip.cutId)) clip = null;
    const sib = p.children[idx - 1] || p.children[idx] || p;
    state.sel = sib.id;
    render();
  }

  let clip = null;

  function syncCutMark() {
    nodesLayer.querySelectorAll('.mm-node.cutting').forEach((el) => el.classList.remove('cutting'));
    if (clip && clip.cutId) {
      const n = MMModel.findNode(state.root, clip.cutId);
      const el = n ? MMRender.getNodeEl(clip.cutId) : null;
      if (el) el.classList.add('cutting');
      else clip = null;
    }
  }

  function reassignIdsDeep(n) {
    n.id = MMModel.nid();
    (n.children || []).forEach(reassignIdsDeep);
  }

  function copyNode(id) {
    const n = MMModel.findNode(state.root, id);
    if (!n) return;
    clip = { tree: MMModel.cloneTree(n), cutId: null };
    toast('已复制节点（含子主题' + ((n.children || []).length ? '和附件引用' : '') + '）');
  }

  function cutNode(id) {
    if (!id || id === state.root.id) { toast('根节点不能剪切'); return; }
    const n = MMModel.findNode(state.root, id);
    if (!n) return;
    clip = { tree: MMModel.cloneTree(n), cutId: id };
    render();
    toast('已剪切节点，Ctrl+V 粘贴到选中节点');
  }

  function pasteNode(parentId) {
    if (!clip || !clip.tree) { toast('剪贴板为空，请先复制或剪切节点', true); return; }
    const parent = MMModel.findNode(state.root, parentId);
    if (!parent) return;
    if (clip.cutId) {
      const src = MMModel.findNode(state.root, clip.cutId);
      if (src) {
        if (clip.cutId === parentId || MMModel.isDescendantOf(src, parentId)) {
          toast('不能粘贴到自身或其子节点中', true);
          return;
        }
        const cutId = clip.cutId;
        clip = null;
        moveNode(cutId, parentId, parent.children.length);
        toast('已粘贴（移动）到选中节点');
        return;
      }
      clip = null;
    }
    pushUndo();
    const t = JSON.parse(JSON.stringify(clip.tree));
    reassignIdsDeep(t);
    parent.children.push(t);
    if (parent.collapsed) parent.collapsed = false;
    state.sel = t.id;
    render();
    toast('已粘贴为「' + (parent.text || '').slice(0, 10) + '」的子主题');
  }

  let rs = null;
  let rsRaf = 0;

  function startResize(e, id, mode) {
    const el = MMRender.getNodeEl(id);
    const n = MMModel.findNode(state.root, id);
    if (!el || !n) return;
    select(id);
    rs = {
      id: id,
      mode: mode,
      sx: e.clientX,
      sy: e.clientY,
      sw: el.offsetWidth,
      sh: el.offsetHeight,
      snap: JSON.stringify(MMModel.cleanTree(state.root)),
      changed: false
    };
    window.addEventListener('mousemove', onResizeMove);
    window.addEventListener('mouseup', onResizeUp, { once: true });
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizeMove(e) {
    if (!rs) return;
    const n = MMModel.findNode(state.root, rs.id);
    if (!n) return;
    const dx = (e.clientX - rs.sx) / (state.zoom || 1);
    const dy = (e.clientY - rs.sy) / (state.zoom || 1);
    let w = rs.sw;
    let h = rs.sh;
    if (rs.mode === 'e' || rs.mode === 'se') w = Math.max(60, Math.round(rs.sw + dx));
    if (rs.mode === 's' || rs.mode === 'se') h = Math.max(28, Math.round(rs.sh + dy));
    if (w !== Math.round(n.w || 0) || h !== Math.round(n.h || 0)) rs.changed = true;
    n.w = w;
    n.h = h;
    if (!rsRaf) {
      rsRaf = requestAnimationFrame(() => { rsRaf = 0; render(); });
    }
  }

  function onResizeUp() {
    window.removeEventListener('mousemove', onResizeMove);
    const r = rs;
    rs = null;
    if (!r || !r.changed) { render(); return; }
    state.undo.push(r.snap);
    if (state.undo.length > 200) state.undo.shift();
    state.redo.length = 0;
    state.modified = true;
    setDirty(true);
    render();
    if (state.path) doSave(false, true);
    toast('已调整格子尺寸');
  }

  function setNodeSize(id, w, h) {
    const n = MMModel.findNode(state.root, id);
    if (!n) return;
    pushUndo();
    n.w = Math.max(0, Math.round(w || 0));
    n.h = Math.max(0, Math.round(h || 0));
    render();
  }

  function optimizeSizes() {
    if (!state.root) return;
    pushUndo();
    const depth = new Map();
    MMModel.walk(state.root, (n, p) => depth.set(n.id, p ? (depth.get(p.id) || 0) + 1 : 0));
    let maxDepth = 0;
    depth.forEach((d) => { if (d > maxDepth) maxDepth = d; });
    const MAXF = 26;
    const MINF = 13;
    MMModel.walk(state.root, (n) => {
      const d = depth.get(n.id) || 0;
      n.fs = Math.max(MINF, Math.round(MAXF - (MAXF - MINF) * (maxDepth ? d / maxDepth : 0)));
      n.w = 0;
      n.h = 0;
    });
    render();
    const natW = new Map();
    MMModel.walk(state.root, (n) => {
      const el = MMRender.getNodeEl(n.id);
      if (el && !el.classList.contains('hidden')) natW.set(n.id, el.offsetWidth);
    });
    MMModel.walk(state.root, (n) => {
      if (!natW.has(n.id)) return;
      const d = depth.get(n.id) || 0;
      const p = d < LEVEL_PRESETS.length ? LEVEL_PRESETS[d] : LEVEL_DEEP;
      const capW = d === 0 ? 400 : (d === 1 ? 260 : 200);
      n.w = Math.max(p.w, Math.min(natW.get(n.id) || p.w, capW));
    });
    render();
    MMModel.walk(state.root, (n) => {
      const el = MMRender.getNodeEl(n.id);
      if (!el || el.classList.contains('hidden')) return;
      const d = depth.get(n.id) || 0;
      const p = d < LEVEL_PRESETS.length ? LEVEL_PRESETS[d] : LEVEL_DEEP;
      n.h = Math.max(p.h, el.offsetHeight);
    });
    render();
    if (state.path) doSave(false, true);
    toast('已一键调整格式（共 ' + (maxDepth + 1) + ' 级，字号 ' + MAXF + '→' + MINF + ' 递减）');
  }

  const LEVEL_PRESETS = [
    { w: 340, h: 96, fs: 26 },
    { w: 240, h: 64, fs: 20 },
    { w: 190, h: 52, fs: 17 },
    { w: 160, h: 44, fs: 15 }
  ];
  const LEVEL_DEEP = { w: 140, h: 40, fs: 14 };

  const applyLevelSizes = optimizeSizes;

  function moveNode(id, parentId, index) {
    const node = MMModel.findNode(state.root, id);
    if (!node || id === parentId) return false;
    if (MMModel.isDescendantOf(node, parentId)) { toast('不能移动到自己的子节点中', true); return false; }
    const oldParent = MMModel.findParent(state.root, id);
    if (!oldParent) return false;
    pushUndo();
    const oldIdx = oldParent.children.findIndex((c) => c.id === id);
    oldParent.children.splice(oldIdx, 1);
    const np = MMModel.findNode(state.root, parentId);
    if (!np) { render(); return false; }
    if (np.collapsed) np.collapsed = false;
    const at = Math.max(0, Math.min(index, np.children.length));
    np.children.splice(at, 0, node);
    state.sel = id;
    render();
    return true;
  }

  function toggleCollapse(id) {
    const n = MMModel.findNode(state.root, id);
    if (!n || !(n.children || []).length) return;
    pushUndo();
    n.collapsed = !n.collapsed;
    render();
  }

  function collapseAll() {
    pushUndo();
    MMModel.walk(state.root, (n) => { if ((n.children || []).length) n.collapsed = true; });
    render();
  }

  function expandAll() {
    pushUndo();
    MMModel.walk(state.root, (n) => { n.collapsed = false; });
    render();
  }

  function setNodeText(id, text) {
    const n = MMModel.findNode(state.root, id);
    if (!n || n.text === text) return;
    pushUndo();
    n.text = text;
    render();
  }

  function applyNodeStyle(id, fn) {
    const n = MMModel.findNode(state.root, id);
    if (!n) return;
    pushUndo();
    fn(n);
    render();
  }

  function applyStyle(fn) {
    if (state.sel) applyNodeStyle(state.sel, fn);
  }

  function toggleNodeFlag(key) {
    if (!state.sel) return;
    const n = MMModel.findNode(state.root, state.sel);
    if (!n) return;
    applyNodeStyle(state.sel, (nd) => { nd[key] = !nd[key]; });
  }

  function startEdit(id, selectAll) {
    if (state.editing) commitEdit(true);
    const n = MMModel.findNode(state.root, id);
    if (!n) return;
    const el = MMRender.getNodeEl(id);
    if (!el) return;
    state.sel = id;
    state.editing = true;
    const t = el.querySelector('.mm-node-text');
    const input = document.createElement('input');
    input.className = 'mm-edit-input';
    input.value = n.text;
    input.style.backgroundColor = el.style.backgroundColor || '#fffef2';
    input.style.color = el.style.color || '#2b3245';
    input.style.fontWeight = n.bold ? '700' : '400';
    input.style.fontStyle = n.it ? 'italic' : 'normal';
    t.style.display = 'none';
    el.appendChild(input);
    editCtx = { id: id, input: input, textEl: t };
    sizeEditInput();
    input.focus();
    if (selectAll !== false) input.select();
    input.addEventListener('keydown', (e) => {
      if (e.ctrlKey && !e.shiftKey) {
        const k = e.key.toLowerCase();
        if (k === 'b' || k === 'i') {
          e.preventDefault();
          const key = k === 'b' ? 'bold' : 'it';
          const n = MMModel.findNode(state.root, editCtx.id);
          if (n) {
            n[key] = !n[key];
            input.style.fontWeight = n.bold ? '700' : '400';
            input.style.fontStyle = n.it ? 'italic' : 'normal';
            pushUndo();
            render();
          }
          e.stopPropagation();
          return;
        }
      }
      if (e.key === 'Enter') { e.preventDefault(); commitEdit(true); }
      else if (e.key === 'Escape') { e.preventDefault(); commitEdit(false); }
      e.stopPropagation();
    });
    input.addEventListener('input', sizeEditInput);
    input.addEventListener('blur', () => { commitEdit(true); });
  }

  function sizeEditInput() {
    if (!editCtx) return;
    const w = Math.max(120, Math.min(320, editCtx.input.scrollWidth + 16));
    editCtx.input.style.width = w + 'px';
  }

  function commitEdit(save) {
    if (!state.editing || !editCtx) return;
    const ctx = editCtx;
    editCtx = null;
    state.editing = false;
    const val = save ? ctx.input.value.replace(/\s+$/, '') : null;
    ctx.input.remove();
    ctx.textEl.style.display = '';
    if (save) {
      const n = MMModel.findNode(state.root, ctx.id);
      if (n && n.text !== val) { pushUndo(); n.text = val; }
    }
    render();
  }

  function startNodeDrag(e, id) {
    select(id);
    drag = { id: id, sx: e.clientX, sy: e.clientY, active: false, targetId: null, zone: null };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragUp, { once: true });
  }

  function onDragMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 5) return;
      drag.active = true;
      const el = MMRender.getNodeEl(drag.id);
      if (el) el.classList.add('dragging');
      canvas.classList.add('dropping');
    }
    updateDropTarget(e);
  }

  function clearDropMarks() {
    nodesLayer.querySelectorAll('.drop-child,.drop-before,.drop-after').forEach((el) => {
      el.classList.remove('drop-child', 'drop-before', 'drop-after');
    });
  }

  function updateDropTarget(e) {
    clearDropMarks();
    drag.targetId = null;
    drag.zone = null;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left - state.pan.x) / state.zoom;
    const cy = (e.clientY - rect.top - state.pan.y) / state.zoom;
    const node = MMModel.findNode(state.root, drag.id);
    if (!node) return;
    let best = null;
    let bestDist = Infinity;
    state.pos.forEach((p, id) => {
      if (id === drag.id) return;
      if (MMModel.isDescendantOf(node, id)) return;
      const s = state.sizes.get(id);
      if (!s) return;
      const dx = cx - (p.x + s.w / 2);
      const dy = cy - (p.y + s.h / 2);
      if (Math.abs(dx) > s.w / 2 + 14 || Math.abs(dy) > s.h / 2 + 12) return;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = id; }
    });
    if (!best) return;
    const s = state.sizes.get(best);
    const p = state.pos.get(best);
    const relY = cy - p.y;
    let zone;
    if (relY < s.h * 0.25) zone = 'before';
    else if (relY > s.h * 0.75) zone = 'after';
    else zone = 'child';
    const target = MMModel.findNode(state.root, best);
    if (zone !== 'child' && target === state.root) return;
    drag.targetId = best;
    drag.zone = zone;
    const el = MMRender.getNodeEl(best);
    if (el) el.classList.add(zone === 'child' ? 'drop-child' : zone === 'before' ? 'drop-before' : 'drop-after');
  }

  function onDragUp() {
    window.removeEventListener('mousemove', onDragMove);
    const d = drag;
    drag = null;
    clearDropMarks();
    canvas.classList.remove('dropping');
    if (!d) return;
    const el = MMRender.getNodeEl(d.id);
    if (el) el.classList.remove('dragging');
    if (!d.active || !d.targetId) return;
    if (d.zone === 'child') {
      moveNode(d.id, d.targetId, MMModel.findNode(state.root, d.targetId).children.length);
    } else {
      const p = MMModel.findParent(state.root, d.targetId);
      if (!p) return;
      const idx = p.children.findIndex((c) => c.id === d.targetId);
      moveNode(d.id, p.id, d.zone === 'before' ? idx : idx + 1);
    }
  }

  function zoomStep(f) {
    setZoom(state.zoom * f);
  }

  function setZoom(z) {
    state.zoom = Math.min(4, Math.max(0.15, z));
    applyView();
  }

  function zoomAt(cx, cy, factor) {
    const nz = Math.min(4, Math.max(0.15, state.zoom * factor));
    const k = nz / state.zoom;
    state.pan.x = cx - (cx - state.pan.x) * k;
    state.pan.y = cy - (cy - state.pan.y) * k;
    state.zoom = nz;
    applyView();
  }

  function applyView() {
    viewport.style.transform = 'translate(' + state.pan.x + 'px, ' + state.pan.y + 'px) scale(' + state.zoom + ')';
    canvas.style.backgroundPosition = state.pan.x + 'px ' + state.pan.y + 'px';
    stZoom.textContent = Math.round(state.zoom * 100) + '%';
  }

  function setPan(x, y) {
    state.pan.x = x;
    state.pan.y = y;
    applyView();
  }

  function centerView() {
    state.pan.x = canvas.clientWidth / 2;
    state.pan.y = canvas.clientHeight / 2;
    setZoom(1);
  }

  function fitView() {
    if (!state.pos.size) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    state.pos.forEach((p, id) => {
      const s = state.sizes.get(id);
      if (!s) return;
      const el = MMRender.getNodeEl(id);
      if (el && el.classList.contains('hidden')) return;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.w);
      maxY = Math.max(maxY, p.y + s.h);
    });
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const z = Math.min((cw - 80) / bw, (ch - 80) / bh, 1.2);
    setZoom(Math.max(0.15, z));
    state.pan.x = cw / 2 - (minX + bw / 2) * state.zoom;
    state.pan.y = ch / 2 - (minY + bh / 2) * state.zoom;
    applyView();
  }

  function centerOnNode(id, smooth) {
    const p = state.pos.get(id);
    const s = state.sizes.get(id);
    if (!p || !s) return;
    state.pan.x = canvas.clientWidth / 2 - (p.x + s.w / 2) * state.zoom;
    state.pan.y = canvas.clientHeight / 2 - (p.y + s.h / 2) * state.zoom;
    if (smooth) {
      viewport.classList.add('view-smooth');
      applyView();
      clearTimeout(centerOnNode._t);
      centerOnNode._t = setTimeout(() => viewport.classList.remove('view-smooth'), 340);
    } else {
      applyView();
    }
  }

  function computeTrackState() {
    const fade = new Map();
    const ops = new Map();
    state.trackFade = fade;
    state.trackOp = ops;
    state.trackZone = null;
    if (!state.trackMode || !state.sel) return;
    const p = state.pos.get(state.sel);
    const s = state.sizes.get(state.sel);
    if (!p || !s) return;
    const range = Math.max(20, Math.min(100, state.trackRange || 65)) / 100;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const cx = p.x + s.w / 2;
    const cy = p.y + s.h / 2;
    const r65 = range * Math.min(W, H) / 2;
    const rMax = Math.max(r65 + 1, Math.hypot(W / 2, H / 2) * 1.25);
    state.trackZone = { cx: cx, cy: cy, r: r65 };
    const vx1 = cx - W / 2 - 40;
    const vx2 = cx + W / 2 + 40;
    const vy1 = cy - H / 2 - 40;
    const vy2 = cy + H / 2 + 40;
    MMModel.walk(state.root, (n) => {
      const np = state.pos.get(n.id);
      const ns = state.sizes.get(n.id);
      if (!np || !ns) return;
      const ncx = np.x + ns.w / 2;
      const ncy = np.y + ns.h / 2;
      let d = (Math.hypot(ncx - cx, ncy - cy) - r65) / (rMax - r65);
      if (np.x + ns.w < vx1 || np.x > vx2 || np.y + ns.h < vy1 || np.y > vy2) d = 1;
      d = Math.max(0, Math.min(1, d));
      fade.set(n.id, d);
      ops.set(n.id, trackOpacity(d));
    });
  }

  function trackOpacity(d) {
    const t = Math.max(0, Math.min(1, d));
    return 1 - t * t * (3 - 2 * t);
  }

  function applyTrackStyles() {
    const ops = state.trackMode ? state.trackOp : null;
    const fade = state.trackMode ? state.trackFade : null;
    const zone = state.trackMode ? state.trackZone : null;
    const circle = $('track-circle');
    if (circle) {
      if (zone) {
        circle.classList.remove('hidden');
        circle.style.left = (zone.cx - zone.r) + 'px';
        circle.style.top = (zone.cy - zone.r) + 'px';
        circle.style.width = (zone.r * 2) + 'px';
        circle.style.height = (zone.r * 2) + 'px';
      } else {
        circle.classList.add('hidden');
      }
    }
    MMModel.walk(state.root, (n) => {
      const el = MMRender.getNodeEl(n.id);
      if (!el) return;
      if (el.style.transform.indexOf('scale') >= 0) {
        el.style.transform = el.style.transform.replace(/\s*scale\([^)]*\)/, '');
      }
      if (el.style.opacity) el.style.opacity = '';
      el.classList.remove('track-hidden');
      if (!ops) return;
      const op = ops.get(n.id) === undefined ? 1 : ops.get(n.id);
      const d = fade.get(n.id) === undefined ? 0 : fade.get(n.id);
      el.style.opacity = op >= 0.995 ? '' : op.toFixed(3);
      if (n.id === state.sel && state.trackZoom > 1) {
        el.style.transform = el.style.transform + ' scale(' + state.trackZoom + ')';
      }
      el.classList.toggle('track-hidden', op < 0.04);
    });
  }

  function toggleTrack() {
    state.trackMode = !state.trackMode;
    closeTrackPopup();
    const btn = $('btn-track');
    if (btn) btn.classList.toggle('active', state.trackMode);
    if (state.trackMode) {
      if (state.sel) centerOnNode(state.sel, false);
      render();
      toast('追踪模式已开启（F4 关闭）');
    } else {
      state.trackFade = new Map();
      render();
      toast('追踪模式已关闭');
    }
  }

  function setTrackRange(v) {
    const n = Math.round(Number(v));
    if (!isFinite(n)) return;
    state.trackRange = Math.max(20, Math.min(100, n));
    const inp = $('inp-track-range');
    if (inp && String(inp.value) !== String(state.trackRange)) inp.value = String(state.trackRange);
    if (state.trackMode) render();
  }

  function setTrackZoom(v) {
    const n = Math.round(Number(v) * 10) / 10;
    if (!isFinite(n)) return;
    state.trackZoom = Math.max(1, Math.min(3, n));
    const inp = $('inp-track-zoom');
    if (inp && String(inp.value) !== String(state.trackZoom)) inp.value = String(state.trackZoom);
    if (state.trackMode) applyTrackStyles();
  }

  function trackNavCands(axis, dir, fromId) {
    const cur = state.pos.get(fromId);
    const cs = state.sizes.get(fromId);
    if (!cur || !cs) return [];
    const cx = cur.x + cs.w / 2;
    const cy = cur.y + cs.h / 2;
    const node = MMModel.findNode(state.root, fromId);
    if (!node) return [];
    const adj = [];
    const parent = MMModel.findParent(state.root, fromId);
    if (parent) adj.push(parent);
    (node.children || []).forEach((c) => adj.push(c));
    const out = [];
    adj.forEach((n) => {
      const p = state.pos.get(n.id);
      const s2 = state.sizes.get(n.id);
      if (!p || !s2) return;
      if ((state.trackOp.get(n.id) || 0) < 0.1) return;
      const ncx = p.x + s2.w / 2;
      const ncy = p.y + s2.h / 2;
      if (axis === 'h' ? (ncx - cx) * dir > 1 : (ncy - cy) * dir > 1) {
        out.push({ id: n.id, x: ncx, y: ncy });
      }
    });
    return out;
  }

  function trackNav(axis, dir) {
    const key = axis + dir;
    const oppKey = axis + (-dir);
    const anchorValid = state.trackNavAnchor && !!MMModel.findNode(state.root, state.trackNavAnchor);
    if (anchorValid && state.trackNavKey === key && state.trackNavCands.length >= 2) {
      const nextIdx = (state.trackNavIdx + 1) % state.trackNavCands.length;
      const nid = state.trackNavCands[nextIdx];
      if (MMModel.findNode(state.root, nid)) {
        state.trackNavIdx = nextIdx;
        select(nid, true);
        return true;
      }
    }
    let fromId = (anchorValid && (state.trackNavKey === key || state.trackNavKey === oppKey))
      ? state.trackNavAnchor : state.sel;
    let cands = trackNavCands(axis, dir, fromId);
    if (cands.length < 2 && fromId !== state.sel) cands = trackNavCands(axis, dir, state.sel);
    if (cands.length < 2) {
      state.trackNavAnchor = null;
      state.trackNavKey = '';
      state.trackNavCands = [];
      return false;
    }
    cands.sort((a, b) => (axis === 'h' ? a.y - b.y : a.x - b.x));
    const cur = state.pos.get(state.sel);
    const cs = state.sizes.get(state.sel) || { w: 0, h: 0 };
    const ref = axis === 'h' ? cur.y + cs.h / 2 : cur.x + cs.w / 2;
    let best = 0;
    let bd = Infinity;
    cands.forEach((c, i) => {
      const v = axis === 'h' ? c.y : c.x;
      if (Math.abs(v - ref) < bd) { bd = Math.abs(v - ref); best = i; }
    });
    state.trackNavAnchor = fromId;
    state.trackNavKey = key;
    state.trackNavCands = cands.map((c) => c.id);
    state.trackNavIdx = best;
    select(cands[best].id, true);
    return true;
  }

  let trackPopup = { open: false, side: 'right', buffer: '', lists: null };
  const TRACK_POP_SCALE = 0.55;
  const TRACK_POP_ASPECT = 1.618;
  const trunc12 = (t) => (t.length > 12 ? t.slice(0, 12) + '…' : t);

  function trackPopupLists() {
    const sel = state.sel;
    const node = MMModel.findNode(state.root, sel);
    const p = state.pos.get(sel);
    if (!node || !p) return { left: [], right: [] };
    const s = state.sizes.get(sel) || { w: 0, h: 0 };
    const cx = p.x + s.w / 2;
    const left = [];
    const right = [];
    const parent = MMModel.findParent(state.root, sel);
    if (parent) {
      const pp = state.pos.get(parent.id);
      const ps = state.sizes.get(parent.id);
      if (pp && ps) {
        const item = { id: parent.id, text: parent.text || '', y: pp.y + ps.h / 2 };
        ((pp.x + ps.w / 2) < cx ? left : right).push(item);
      }
    }
    (node.children || []).forEach((c) => {
      const cp = state.pos.get(c.id);
      const cs = state.sizes.get(c.id);
      if (!cp || !cs) return;
      const item = { id: c.id, text: c.text || '', y: cp.y + cs.h / 2 };
      ((cp.x + cs.w / 2) < cx ? left : right).push(item);
    });
    left.sort((a, b) => a.y - b.y);
    right.sort((a, b) => a.y - b.y);
    return { left, right };
  }

  function openTrackPopup(side) {
    const lists = trackPopupLists();
    if (!lists.left.length && !lists.right.length) { toast('没有相连的格子'); return; }
    trackPopup.open = true;
    trackPopup.side = side;
    trackPopup.buffer = '';
    trackPopup.lists = lists;
    renderTrackPopup();
  }

  function closeTrackPopup() {
    trackPopup.open = false;
    trackPopup.buffer = '';
    const el = $('track-pop');
    if (el) el.classList.add('hidden');
  }

  function renderTrackPopup() {
    const el = $('track-pop');
    if (!el || !trackPopup.open) return;
    const L = trackPopup.lists.left;
    const R = trackPopup.lists.right;
    const rows = Math.max(L.length, R.length, 1);
    const hintH = 26;
    let height = Math.round(window.innerHeight * TRACK_POP_SCALE);
    let width = Math.round(height * TRACK_POP_ASPECT);
    if (width > window.innerWidth - 24) {
      width = window.innerWidth - 24;
      height = Math.round(width / TRACK_POP_ASPECT);
    }
    const maxRowH = Math.max(28, Math.round(window.innerHeight * 0.07));
    const neededH = rows * 20 + hintH + 12;
    if (neededH > height) {
      height = Math.min(neededH, window.innerHeight - 24);
      width = Math.round(height * TRACK_POP_ASPECT);
      if (width > window.innerWidth - 24) {
        width = window.innerWidth - 24;
        height = Math.round(width / TRACK_POP_ASPECT);
      }
    }
    const rowH = Math.max(20, Math.min(maxRowH, Math.floor((height - hintH - 12) / rows)));
    const nodeH = Math.max(14, Math.min(rowH - 6, Math.round((width * 0.262) / TRACK_POP_ASPECT)));
    const nodeW = Math.round(nodeH * TRACK_POP_ASPECT);
    const badgeS = Math.max(14, Math.min(24, Math.round(rowH * 0.5)));
    const fontS = Math.max(10, Math.min(14, Math.round(nodeH * 0.36)));
    const centerH = Math.round(nodeH * TRACK_POP_ASPECT);
    const centerW = Math.round(centerH * TRACK_POP_ASPECT);
    const badgeZone = Math.round(width * 0.077);
    const rect = canvas.getBoundingClientRect();
    const p = state.pos.get(state.sel);
    const s = state.sizes.get(state.sel) || { w: 0, h: 0 };
    const sx = rect.left + state.pan.x + (p.x + s.w / 2) * state.zoom;
    const sy = rect.top + state.pan.y + (p.y + s.h / 2) * state.zoom;
    let px = Math.max(12, Math.min(sx - width / 2, window.innerWidth - width - 12));
    let py = Math.max(12, Math.min(sy - height / 2, window.innerHeight - height - 12));
    el.style.left = px + 'px';
    el.style.top = py + 'px';
    el.style.width = width + 'px';
    el.style.height = height + 'px';
    el.textContent = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.style.position = 'absolute';
    svg.style.left = '0';
    svg.style.top = '0';
    el.appendChild(svg);
    const cx = width / 2;
    const cy = (height - hintH) / 2;
    const addEdge = (x1, y1, x2, y2) => {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const mx = x1 + (x2 - x1) * 0.5;
      path.setAttribute('d', 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(60, 60, 67, 0.22)');
      path.setAttribute('stroke-width', '1.25');
      svg.appendChild(path);
    };
    const mkNode = (x, y, w, h, text, isCenter) => {
      const d = document.createElement('div');
      d.className = 'tp-node' + (isCenter ? ' center' : '');
      d.textContent = text;
      d.style.left = x + 'px';
      d.style.top = y + 'px';
      d.style.width = w + 'px';
      d.style.height = h + 'px';
      d.style.lineHeight = (h - 2) + 'px';
      d.style.fontSize = fontS + 'px';
      el.appendChild(d);
    };
    const mkBadge = (x, y, num, active) => {
      const b = document.createElement('div');
      b.className = 'tp-badge' + (active ? ' active' : '');
      b.textContent = String(num);
      b.style.left = x + 'px';
      b.style.top = y + 'px';
      b.style.width = badgeS + 'px';
      b.style.height = badgeS + 'px';
      b.style.fontSize = Math.max(10, Math.round(badgeS * 0.55)) + 'px';
      el.appendChild(b);
    };
    const rowY = (n, i) => cy - (n * rowH) / 2 + rowH / 2 + i * rowH;
    L.forEach((item, i) => {
      const y = rowY(L.length, i);
      addEdge(cx - centerW / 2, cy, cx - centerW / 2 - badgeZone + nodeW, y);
      mkNode(cx - centerW / 2 - badgeZone - nodeW, y - nodeH / 2, nodeW, nodeH, trunc12(item.text), false);
      mkBadge(cx - centerW / 2 - badgeZone + (badgeZone - badgeS) / 2, y - badgeS / 2, i + 1, trackPopup.side === 'left');
    });
    R.forEach((item, i) => {
      const y = rowY(R.length, i);
      addEdge(cx + centerW / 2, cy, cx + centerW / 2 + badgeZone, y);
      mkNode(cx + centerW / 2 + badgeZone, y - nodeH / 2, nodeW, nodeH, trunc12(item.text), false);
      mkBadge(cx + centerW / 2 + (badgeZone - badgeS) / 2, y - badgeS / 2, i + 1, trackPopup.side === 'right');
    });
    const centerNode = MMModel.findNode(state.root, state.sel);
    mkNode(cx - centerW / 2, cy - centerH / 2, centerW, centerH, trunc12((centerNode && centerNode.text) || ''), true);
    const hint = document.createElement('div');
    hint.className = 'tp-hint';
    hint.innerHTML = '已输入 <span class="tp-buf">' + (trackPopup.buffer || '—') + '</span> · '
      + (trackPopup.side === 'left' ? '左' : '右') + '侧 1–'
      + (trackPopup.side === 'left' ? L.length : R.length) + ' · Enter 跳转 · Esc 取消';
    el.appendChild(hint);
    el.classList.remove('hidden');
  }

  function commitTrackPopupJump() {
    const n = parseInt(trackPopup.buffer, 10);
    const list = trackPopup.side === 'left' ? trackPopup.lists.left : trackPopup.lists.right;
    if (!n || n < 1 || n > list.length) { renderTrackPopup(); return; }
    const target = list[n - 1];
    closeTrackPopup();
    select(target.id);
  }

  function handleTrackPopupKey(e) {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); closeTrackPopup(); return; }
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      const side = k === 'ArrowLeft' ? 'left' : 'right';
      const list = trackPopup.lists[side];
      if (list.length === 1) {
        const target = list[0];
        closeTrackPopup();
        select(target.id);
        return;
      }
      if (list.length > 1) {
        trackPopup.side = side;
        trackPopup.buffer = '';
        renderTrackPopup();
      }
      return;
    }
    if (k === 'Enter') { e.preventDefault(); commitTrackPopupJump(); return; }
    if (/^[0-9]$/.test(k)) {
      e.preventDefault();
      trackPopup.buffer = (trackPopup.buffer + k).slice(0, 3);
      renderTrackPopup();
      return;
    }
    if (k === 'Backspace') {
      e.preventDefault();
      trackPopup.buffer = trackPopup.buffer.slice(0, -1);
      renderTrackPopup();
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Tab' || k === ' ') e.preventDefault();
  }

  function navVertical(dir) {
    if (state.trackMode && trackNav('v', dir)) return;
    const cur = state.pos.get(state.sel);
    if (!cur) return;
    const curS = state.sizes.get(state.sel) || { w: 0, h: 0 };
    const curCx = cur.x + curS.w / 2;
    const curCy = cur.y + curS.h / 2;
    let best = null;
    let bestKey = Infinity;
    state.pos.forEach((p, id) => {
      if (id === state.sel) return;
      const s = state.sizes.get(id);
      if (!s) return;
      const n = MMModel.findNode(state.root, id);
      if (!n || isHiddenNode(n)) return;
      const cx = p.x + s.w / 2;
      const cy = p.y + s.h / 2;
      const dy = (cy - curCy) * dir;
      if (dy < 6) return;
      const key = dy + Math.abs(cx - curCx) * 0.001;
      if (key < bestKey) { bestKey = key; best = id; }
    });
    if (best) select(best);
  }

  function navHoriz(dir) {
    if (state.trackMode) {
      const list = trackPopupLists()[dir > 0 ? 'right' : 'left'];
      if (list.length === 1) { select(list[0].id); return; }
      if (list.length > 1) { openTrackPopup(dir > 0 ? 'right' : 'left'); return; }
    }
    const n = MMModel.findNode(state.root, state.sel);
    if (!n) return;
    const side = state.sides.get(n.id) || 0;
    const outward = side === 0 ? dir : side;
    if (dir === outward) {
      if ((n.children || []).length) {
        if (n.collapsed) toggleCollapse(n.id);
        state.sel = n.children[0].id;
        render();
      }
    } else {
      const p = MMModel.findParent(state.root, n.id);
      if (p) select(p.id);
    }
  }

  async function doOpen(path) {
    const A = api();
    if (!A) { toast('桥接未就绪，无法打开文件', true); return; }
    let p = path;
    if (!p) {
      p = await A.pick_open_file();
      if (!p) return;
    }
    if (state.modified) {
      const go = await confirmModal('当前导图有未保存的修改，打开新文件将丢失这些修改。继续吗？');
      if (!go) return;
    }
    const doc = await A.load_map(p);
    if (!doc || !doc.ok) { toast('打开失败：' + ((doc && doc.error) || '未知错误'), true); return; }
    loadDoc(doc);
    toast('已打开 ' + doc.name);
  }

  function loadDoc(doc) {
    closeTrackPopup();
    if (state.editing) commitEdit(false);
    state.root = doc.root;
    MMModel.assignIds(state.root);
    state.path = doc.path || '';
    state.name = doc.name || '未命名';
    state.format = doc.format || '';
    state.multiSel.clear();
    state.layout = MMLayout.LAYOUT_MODES.indexOf(doc.layout) >= 0 ? doc.layout : 'map-balance';
    state.theme = MMRender.THEMES[doc.theme] ? doc.theme : 'default';
    state.modified = false;
    setDirty(false);
    state.undo.length = 0;
    state.redo.length = 0;
    state.sel = state.root.id;
    applyTheme();
    render();
    centerView();
    setConfig({ lastFile: state.path });
  }

  async function doSave(saveAs, silent) {
    const A = api();
    if (!A) { toast('桥接未就绪，无法保存', true); return; }
    if (state.editing) commitEdit(true);
    if (state.format === 'xmind' && !saveAs) {
      const base = String(state.path || '').replace(/\.xmind$/i, '');
      if (base) {
        state.path = base + '.mm';
        state.format = 'mm';
        const parts = state.path.split(/[\\/]/);
        state.name = parts[parts.length - 1];
      } else {
        saveAs = true;
      }
    }
    if (saveAs || !state.path) {
      const defName = (state.name || '未命名').replace(/\.xmind$/i, '') + '.mm';
      const p = await A.get_save_path(defName);
      if (!p) return;
      state.path = p;
      const parts = p.split(/[\\/]/);
      state.name = parts[parts.length - 1];
      state.format = state.name.toLowerCase().endsWith('.xml') ? 'xml' : 'mm';
    }
    const res = await A.save_map(state.path, {
      root: MMModel.cleanTree(state.root),
      layout: state.layout,
      theme: state.theme
    });
    if (!res || !res.ok) { toast('保存失败：' + ((res && res.error) || '未知错误'), true); return; }
    state.modified = false;
    setDirty(false);
    render();
    setConfig({ lastFile: state.path });
    if (!silent) toast('已保存到 ' + state.name);
  }

  async function doNew() {
    if (state.modified) {
      const go = await confirmModal('当前导图有未保存的修改，新建将丢失这些修改。继续吗？');
      if (!go) return;
    }
    newMap('中心主题');
    toast('已新建导图');
  }

  function newMap(rootText) {
    if (state.editing) { editCtx = null; state.editing = false; }
    state.root = MMModel.createNode(rootText || '中心主题');
    state.path = '';
    state.name = '未命名';
    state.format = '';
    state.layout = 'map-balance';
    state.theme = 'default';
    state.modified = false;
    state.multiSel.clear();
    setDirty(false);
    state.undo.length = 0;
    state.redo.length = 0;
    state.sel = state.root.id;
    applyTheme();
    render();
    centerView();
    ensureTabObj();
    snapshotTab();
  }

  function ensureTabObj() {
    if (!tabs[activeTab]) tabs[activeTab] = { id: ++tabSeq, modified: false };
  }

  function snapshotTab() {
    ensureTabObj();
    const t = tabs[activeTab];
    TAB_FIELDS.forEach((f) => { t[f] = state[f]; });
    t.modified = state.modified;
  }

  function loadTabIntoState(i) {
    const t = tabs[i];
    TAB_FIELDS.forEach((f) => { state[f] = t[f]; });
    state.modified = !!t.modified;
    state.editing = false;
    state.multiSel.clear();
    editCtx = null;
  }

  function makeTab() {
    return {
      id: ++tabSeq,
      root: MMModel.createNode('中心主题'),
      path: '',
      name: '未命名',
      format: '',
      modified: false,
      layout: 'map-balance',
      theme: 'default',
      sel: null,
      pan: { x: 0, y: 0 },
      zoom: 1,
      undo: [],
      redo: [],
      pos: new Map(),
      sides: new Map(),
      sizes: new Map()
    };
  }

  function addTab() {
    closeAttachPopup();
    closeCtxMenu();
    snapshotTab();
    tabs.push(makeTab());
    activeTab = tabs.length - 1;
    loadTabIntoState(activeTab);
    setDirty(false);
    applyTheme();
    render();
    centerView();
    renderTabs();
    toast('已新建标签页');
  }

  function switchTab(i) {
    if (i === activeTab || !tabs[i]) return;
    if (state.editing) commitEdit(true);
    closeAttachPopup();
    closeCtxMenu();
    drag = null;
    panDrag = null;
    canvas.classList.remove('panning', 'dropping');
    snapshotTab();
    activeTab = i;
    loadTabIntoState(i);
    setDirty(state.modified || tabs.some((t, j) => j !== activeTab && t.modified));
    applyTheme();
    render();
    applyView();
    renderTabs();
  }

  function closeTab(i) {
    if (!tabs[i]) return;
    const doClose = () => {
      tabs.splice(i, 1);
      if (!tabs.length) tabs.push(makeTab());
      if (i < activeTab) activeTab -= 1;
      else if (i === activeTab) activeTab = Math.min(i, tabs.length - 1);
      loadTabIntoState(activeTab);
      setDirty(state.modified || tabs.some((t, j) => j !== activeTab && t.modified));
      applyTheme();
      render();
      applyView();
      renderTabs();
      toast('已关闭标签页');
    };
    const isModified = i === activeTab ? state.modified : !!tabs[i].modified;
    if (isModified) {
      confirmModal('标签页「' + (tabs[i].name || '未命名') + '」有未保存的修改，关闭将丢失。继续吗？').then((go) => {
        if (go) doClose();
      });
      return;
    }
    doClose();
  }

  function setConfig(patch) {
    const A = api();
    if (!A || !A.set_config) return;
    try { A.set_config(patch); } catch (e) { /* ignore */ }
  }

  function toast(msg, isErr) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    toastEl.classList.toggle('error', !!isErr);
    requestAnimationFrame(() => toastEl.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove('show');
      setTimeout(() => toastEl.classList.add('hidden'), 300);
    }, 2200);
  }

  function confirmModal(text) {
    return new Promise((resolve) => {
      modalResolve = resolve;
      modalText.textContent = text;
      modalEl.classList.remove('hidden');
    });
  }

  function settleModal(v) {
    if (modalResolve) { modalResolve(v); modalResolve = null; }
    modalEl.classList.add('hidden');
  }

  function makeSwatch(color, title, setter) {
    const d = document.createElement('div');
    d.className = 'swatch' + (color ? '' : ' none');
    d.title = title;
    d.dataset.color = color;
    if (color) d.style.backgroundColor = color;
    d.addEventListener('click', () => applyStyle((n) => setter(n, color)));
    return d;
  }

  function buildSwatches() {
    BG_COLORS.forEach((c) => bgBox.appendChild(makeSwatch(c, c ? '背景 ' + c : '无背景色', (n, v) => { n.bg = v; })));
    FG_COLORS.forEach((c) => fgBox.appendChild(makeSwatch(c, c ? '文字 ' + c : '默认文字色', (n, v) => { n.color = v; })));
  }

  function syncStylePanel() {
    const n = MMModel.findNode(state.root, state.sel);
    if (!n) return;
    chkBold.checked = !!n.bold;
    chkItalic.checked = !!n.it;
    chkUnderline.checked = !!n.ul;
    selFontsize.value = String(Math.max(0, Math.round(n.fs || 0)));
    inpLatex.value = n.latex || '';
    [bgBox, fgBox].forEach((box) => {
      box.querySelectorAll('.swatch').forEach((sw) => {
        const key = box === bgBox ? 'bg' : 'color';
        sw.classList.toggle('active', (n[key] || '') === sw.dataset.color);
      });
    });
  }

  function renderAttachPanel() {
    const list = $('attach-list');
    if (!list) return;
    const n = state.sel ? MMModel.findNode(state.root, state.sel) : null;
    list.textContent = '';
    if (!n) return;
    const items = n.attach || [];
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'attach-empty';
      empty.textContent = '暂无附件';
      list.appendChild(empty);
      return;
    }
    items.forEach((a, idx) => {
      const row = document.createElement('div');
      row.className = 'attach-item';
      const name = document.createElement('span');
      name.className = 'attach-name';
      name.textContent = a.name;
      name.title = '点击打开：' + a.name;
      name.addEventListener('click', () => openAttachment(a));
      const del = document.createElement('span');
      del.className = 'attach-del';
      del.textContent = '\u00d7';
      del.title = '移除附件引用';
      del.addEventListener('click', () => removeAttachment(idx));
      row.appendChild(name);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  async function addAttachment() {
    const A = api();
    if (!A) { toast('桥接未就绪', true); return; }
    if (!state.path) { toast('请先保存导图（Ctrl+S），再插入附件', true); return; }
    const n = state.sel ? MMModel.findNode(state.root, state.sel) : null;
    if (!n) return;
    const src = await A.pick_attachment_file();
    if (!src) return;
    const res = await A.add_attachment(state.path, src);
    if (!res || !res.ok) { toast('插入附件失败：' + ((res && res.error) || '未知错误'), true); return; }
    pushUndo();
    if (!n.attach) n.attach = [];
    n.attach.push({ name: res.name, data: res.data });
    n.text = res.name;
    render();
    await doSave(false, true);
    toast('已插入附件 ' + res.name + ' 并保存到文件');
  }

  async function saveAttachmentAs(id) {
    const A = api();
    if (!A) { toast('桥接未就绪', true); return; }
    if (!state.path) { toast('请先保存导图', true); return; }
    const n = MMModel.findNode(state.root, id);
    if (!n || !n.attach || !n.attach.length) return;
    const att = n.attach[0];
    const dest = await A.get_save_path_any(att.name || '附件');
    if (!dest) return;
    const res = await A.save_attachment_as(state.path, att, dest);
    if (res && res.ok) toast('附件已另存为 ' + res.path);
    else toast('另存失败：' + ((res && res.error) || '未知错误'), true);
  }

  function openAttachment(entry) {
    const A = api();
    if (!A) { toast('桥接未就绪', true); return; }
    A.open_attachment(state.path, entry).then((res) => {
      if (!res || !res.ok) toast((res && res.error) || '打开失败', true);
    }).catch(() => toast('打开失败', true));
  }

  function removeAttachmentOn(nodeId, idx) {
    const n = MMModel.findNode(state.root, nodeId);
    if (!n || !n.attach || !n.attach[idx]) return;
    pushUndo();
    n.attach.splice(idx, 1);
    render();
    if (state.path) doSave(false, true);
    toast('已移除附件引用（文件保留在 .assets 文件夹）');
  }

  function removeAttachment(idx) {
    if (!state.sel) return;
    removeAttachmentOn(state.sel, idx);
  }

  function parsePathD(d) {
    const cmds = [];
    const re = /([MLCZmlcz])|(-?\d+(?:\.\d+)?(?:e[-+]?\d+)?)/g;
    let cur = null;
    let m;
    const nums = [];
    while ((m = re.exec(d)) !== null) {
      if (m[1]) {
        if (cur) cmds.push({ cmd: cur, args: nums.splice(0) });
        cur = m[1];
      } else {
        nums.push(parseFloat(m[2]));
      }
    }
    if (cur) cmds.push({ cmd: cur, args: nums.splice(0) });
    return cmds;
  }

  function tracePath(ctx, d, sx, sy, ox, oy) {
    const cmds = parsePathD(d);
    for (const { cmd, args } of cmds) {
      if (cmd === 'M') ctx.moveTo(args[0] * sx + ox, args[1] * sy + oy);
      else if (cmd === 'L') ctx.lineTo(args[0] * sx + ox, args[1] * sy + oy);
      else if (cmd === 'C') {
        ctx.bezierCurveTo(
          args[0] * sx + ox, args[1] * sy + oy,
          args[2] * sx + ox, args[3] * sy + oy,
          args[4] * sx + ox, args[5] * sy + oy
        );
      } else if (cmd === 'Z') ctx.closePath();
    }
  }

  function wrapCanvasText(ctx, text, maxW) {
    const lines = [];
    String(text || '').split('\n').forEach((raw) => {
      if (!raw) { lines.push(''); return; }
      let line = '';
      for (const ch of raw) {
        if (ctx.measureText(line + ch).width > maxW && line) {
          lines.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      if (line) lines.push(line);
    });
    return lines;
  }

  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  async function renderMapToDataURL(scale) {
    if (!state.root) return null;
    const th = MMRender.themeOf(state);
    const savedCollapsed = [];
    MMModel.walk(state.root, (n) => {
      if (n.collapsed) savedCollapsed.push(n.id);
    });
    if (savedCollapsed.length) {
      MMModel.walk(state.root, (n) => { n.collapsed = false; });
      render();
    }
    try {
      const layout = MMRender.render(state);
      const edges = MMRender.buildEdgeList(state, layout);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      MMModel.walk(state.root, (n) => {
        const p = state.pos.get(n.id);
        const s = state.sizes.get(n.id);
        if (!p || !s) return;
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x + s.w);
        maxY = Math.max(maxY, p.y + s.h);
      });
      const sp = layout.decor && layout.decor.spine;
      if (sp) {
        minX = Math.min(minX, sp.x1, sp.x2); maxX = Math.max(maxX, sp.x1, sp.x2);
        minY = Math.min(minY, sp.y1, sp.y2); maxY = Math.max(maxY, sp.y1, sp.y2);
      }
      if (!isFinite(minX)) return null;
      const PAD = 60;
      minX -= PAD; minY -= PAD; maxX += PAD; maxY += PAD;
      const mapW = maxX - minX, mapH = maxY - minY;
      let sc = scale || 2;
      const MAX_SIDE = 16000;
      if (Math.max(mapW, mapH) * sc > MAX_SIDE) sc = MAX_SIDE / Math.max(mapW, mapH);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(mapW * sc));
      canvas.height = Math.max(1, Math.round(mapH * sc));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = th.canvas;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const ox = -minX * sc, oy = -minY * sc;

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const e of edges) {
        ctx.strokeStyle = e.color;
        ctx.lineWidth = e.width * sc;
        ctx.beginPath();
        tracePath(ctx, e.d, sc, sc, ox, oy);
        ctx.stroke();
      }

      const A = api();
      const imgCache = new Map();
      async function loadImage(name, embeddedData) {
        const key = (embeddedData ? 'd:' : 'f:') + name;
        if (imgCache.has(key)) return imgCache.get(key);
        const job = (async () => {
          let src = null;
          if (embeddedData) {
            src = MMRender.imgSrc(state, { img: name, imgdata: embeddedData });
          } else if (A && state.path) {
            const res = await A.read_image_data(state.path, name);
            if (!res || !res.ok) return null;
            src = 'data:' + res.mime + ';base64,' + res.data;
          }
          if (!src) return null;
          return await new Promise((resolve) => {
            const im = new Image();
            im.onload = () => resolve(im);
            im.onerror = () => resolve(null);
            im.src = src;
          });
        })();
        imgCache.set(key, job);
        return job;
      }

      const imgJobs = [];
      MMModel.walk(state.root, (n) => {
        if (n.imgdata || n.img) imgJobs.push(loadImage(n.imgdata ? n.img : n.img, n.imgdata));
      });
      await Promise.all(imgJobs);

      function nodeFont(n, isRoot) {
        const fs = (n.fs > 0 ? n.fs : (isRoot ? 17 : 14));
        const weight = n.bold ? '700 ' : (isRoot ? '600 ' : '');
        const style = n.it ? 'italic ' : '';
        return { fs: fs, css: style + weight + fs + 'px "Microsoft YaHei", "PingFang SC", sans-serif' };
      }

      const list = MMModel.visibleList(state.root, (x) => x.collapsed);
      for (const item of list) {
        const n = item.node;
        const p = state.pos.get(n.id);
        const s = state.sizes.get(n.id);
        if (!p || !s) continue;
        const isRoot = n === state.root;
        const x = p.x * sc + ox, y = p.y * sc + oy, w = s.w * sc, h = s.h * sc;
        ctx.save();
        roundRectPath(ctx, x, y, w, h, (isRoot ? 12 : 8) * sc);
        ctx.fillStyle = n.bg || (isRoot ? th.rootBg : th.nodeBg);
        ctx.fill();
        if (!isRoot) {
          ctx.strokeStyle = th.nodeBorder;
          ctx.lineWidth = 1 * sc;
          ctx.stroke();
        }
        ctx.clip();
        const f = nodeFont(n, isRoot);
        ctx.font = f.css;
        ctx.fillStyle = n.color || (isRoot ? th.rootFg : th.nodeFg);
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const padX = (isRoot ? 22 : 14) * sc;
        const maxTextW = w - padX * 2;
        const lines = wrapCanvasText(ctx, n.text, maxTextW);
        const lh = f.fs * 1.45 * sc;
        let imgH = 0, imgEl = null;
        if (n.img || n.imgdata) {
          imgEl = await loadImage(n.img, n.imgdata);
          if (imgEl) {
            const maxIH = 220 * sc;
            const fitW = w - padX * 2;
            const r = Math.min(fitW / imgEl.width, maxIH / imgEl.height, 1);
            imgH = imgEl.height * r;
          }
        }
        let latexH = 0;
        const latex = String(n.latex || '').trim();
        if (latex) latexH = f.fs * 1.3 * sc;
        const totalH = lines.length * lh + (latex ? latexH : 0) + (imgH ? imgH + 6 * sc : 0);
        let cy = y + (h - totalH) / 2 + lh / 2;
        for (const line of lines) {
          ctx.fillText(line, x + w / 2, cy);
          cy += lh;
        }
        if (latex) {
          ctx.font = 'italic ' + Math.round(f.fs * 0.85) + 'px "Cambria Math", "Times New Roman", serif';
          ctx.fillText(latex, x + w / 2, cy);
          cy += latexH;
        }
        if (imgEl && imgH) {
          const dw = imgEl.width * Math.min((w - padX * 2) / imgEl.width, 220 * sc / imgEl.height, 1);
          ctx.drawImage(imgEl, x + (w - dw) / 2, cy - lh / 2 + 3 * sc, dw, imgH);
        }
        ctx.restore();
        if ((n.attach || []).length) {
          ctx.font = 13 * sc + 'px "Segoe UI Emoji", sans-serif';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.fillText('\ud83d\udcce', x + w - 16 * sc, y + 14 * sc);
        }
      }
      return canvas.toDataURL('image/png');
    } finally {
      if (savedCollapsed.length) {
        MMModel.walk(state.root, (n) => {
          if (savedCollapsed.indexOf(n.id) >= 0) n.collapsed = true;
        });
        render();
      }
    }
  }

  async function exportPNG() {
    const A = api();
    if (!A) { toast('桥接未就绪', true); return; }
    if (!state.path) { toast('请先保存导图（Ctrl+S），再导出 PNG', true); return; }
    if (state.editing) commitEdit(true);
    const dpi = parseInt(($('sel-export-dpi') || {}).value, 10) || 200;
    toast('正在生成 ' + dpi + ' DPI 高清 PNG…');
    try {
      const dataUrl = await renderMapToDataURL(dpi / 96);
      if (!dataUrl) { toast('导出失败：无法渲染导图', true); return; }
      const res = await A.save_png(state.path, dataUrl.split(',')[1]);
      if (res && res.ok) toast('已导出 ' + res.name + '（' + dpi + ' DPI）');
      else toast('导出失败：' + ((res && res.error) || '未知错误'), true);
    } catch (e) {
      toast('导出失败：' + String(e), true);
    }
  }

  let attachPopEl = null;

  const find = { open: false, replaceMode: false, matches: [], current: -1 };
  let marquee = null;
  let marqueeSuppressed = false;

  function buildNeedleRegex() {
    const needle = $('inp-find').value;
    if (!needle) return null;
    let src = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if ($('chk-word').checked) src = '(?<![A-Za-z0-9_])' + src + '(?![A-Za-z0-9_])';
    const flags = $('chk-case').checked ? 'g' : 'gi';
    try { return new RegExp(src, flags); } catch (e) { return null; }
  }

  function clearFindHits() {
    document.querySelectorAll('.mm-node.find-hit, .mm-node.find-current').forEach((el) => {
      el.classList.remove('find-hit', 'find-current');
    });
  }

  function updateFindClasses() {
    clearFindHits();
    const hitIds = new Set(find.matches.map((m) => m.id));
    MMModel.walk(state.root, (n) => {
      const el = MMRender.getNodeEl(n.id);
      if (!el) return;
      if (hitIds.has(n.id)) el.classList.add('find-hit');
      if (find.current >= 0 && find.matches[find.current] && find.matches[find.current].id === n.id) {
        el.classList.add('find-current');
      }
    });
  }

  function ensureNodeExpanded(id) {
    let p = MMModel.findParent(state.root, id);
    let changed = false;
    while (p) {
      if (p.collapsed) { p.collapsed = false; changed = true; }
      p = MMModel.findParent(state.root, p.id);
    }
    if (changed) render();
  }

  function revealNode(id) {
    const p = state.pos.get(id);
    const s = state.sizes.get(id);
    if (!p || !s) return;
    const rect = canvas.getBoundingClientRect();
    state.pan.x = rect.width / 2 - (p.x + s.w / 2) * state.zoom;
    state.pan.y = rect.height / 2 - (p.y + s.h / 2) * state.zoom;
    applyView();
  }

  function runSearch(keepIndex) {
    const countEl = $('find-count');
    const q = $('inp-find').value.trim();
    find.matches = [];
    if (!q) {
      find.current = -1;
      countEl.textContent = '请输入关键词';
      countEl.classList.add('find-none');
      updateFindClasses();
      return;
    }
    const re = buildNeedleRegex();
    if (!re) {
      find.current = -1;
      countEl.textContent = '无匹配';
      countEl.classList.add('find-none');
      updateFindClasses();
      return;
    }
    MMModel.walk(state.root, (n) => {
      const hits = n.text.match(re);
      if (hits) hits.forEach((_, i) => find.matches.push({ id: n.id, nth: i }));
    });
    if (!find.matches.length) {
      find.current = -1;
      countEl.textContent = '无匹配';
      countEl.classList.add('find-none');
      updateFindClasses();
      return;
    }
    countEl.classList.remove('find-none');
    if (!keepIndex || find.current < 0) find.current = 0;
    else find.current = Math.min(find.current, find.matches.length - 1);
    countEl.textContent = (find.current + 1) + '/' + find.matches.length;
    updateFindClasses();
    ensureNodeExpanded(find.matches[find.current].id);
    revealNode(find.matches[find.current].id);
  }

  function gotoMatch(dir) {
    if (!find.matches.length) return;
    find.current = (find.current + dir + find.matches.length) % find.matches.length;
    $('find-count').textContent = (find.current + 1) + '/' + find.matches.length;
    updateFindClasses();
    ensureNodeExpanded(find.matches[find.current].id);
    revealNode(find.matches[find.current].id);
    if (state.trackMode) select(find.matches[find.current].id);
  }

  async function replaceCurrent() {
    if (!find.matches.length || find.current < 0) { toast('无匹配', true); return; }
    const re = buildNeedleRegex();
    if (!re) { toast('无匹配', true); return; }
    const rep = $('inp-replace').value;
    const m = find.matches[find.current];
    const n = MMModel.findNode(state.root, m.id);
    if (!n) return;
    let idx = 0;
    const newText = n.text.replace(re, (hit) => (idx++ === m.nth ? rep : hit));
    if (newText !== n.text) {
      pushUndo();
      n.text = newText;
      render();
      await doSave(false, true);
    }
    runSearch(true);
  }

  async function replaceAll() {
    const q = $('inp-find').value.trim();
    if (!q) { toast('请输入关键词', true); return; }
    const re = buildNeedleRegex();
    if (!re) { toast('无匹配', true); return; }
    const rep = $('inp-replace').value;
    let total = 0;
    const changes = [];
    MMModel.walk(state.root, (n) => {
      const hits = n.text.match(re);
      if (hits && hits.length) {
        total += hits.length;
        changes.push({ n: n, newText: n.text.replace(re, () => rep) });
      }
    });
    if (!total) { toast('无匹配', true); return; }
    const go = await confirmModal('共找到 ' + total + ' 处「' + q + '」，全部替换为「' + rep + '」？');
    if (!go) return;
    try {
      pushUndo();
      changes.forEach((c) => { c.n.text = c.newText; });
      render();
      await doSave(false, true);
      toast('已替换 ' + total + ' 处');
    } catch (e) {
      toast('替换出错：' + String(e), true);
    }
    runSearch(false);
  }

  function openFind(replaceMode) {
    find.open = true;
    find.replaceMode = !!replaceMode;
    $('find-bar').classList.remove('hidden');
    $('replace-row').classList.toggle('hidden', !replaceMode);
    $('inp-find').focus();
    $('inp-find').select();
    runSearch(false);
  }

  function closeFind() {
    find.open = false;
    find.matches = [];
    find.current = -1;
    $('find-bar').classList.add('hidden');
    clearFindHits();
  }

  function bindFindBar() {
    $('inp-find').addEventListener('input', () => runSearch(false));
    $('inp-find').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        gotoMatch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeFind();
      }
      e.stopPropagation();
    });
    $('inp-replace').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
      e.stopPropagation();
    });
    $('btn-find-prev').addEventListener('click', () => gotoMatch(-1));
    $('btn-find-next').addEventListener('click', () => gotoMatch(1));
    $('btn-find-close').addEventListener('click', closeFind);
    $('btn-replace-one').addEventListener('click', replaceCurrent);
    $('btn-replace-all').addEventListener('click', replaceAll);
    $('chk-case').addEventListener('change', () => runSearch(true));
    $('chk-word').addEventListener('change', () => runSearch(true));
  }

  function deleteNodes(ids) {
    const idSet = new Set((ids || []).filter((x) => x && x !== state.root.id));
    if (!idSet.size) return;
    pushUndo();
    function prune(n) {
      n.children = (n.children || []).filter((c) => {
        if (idSet.has(c.id)) return false;
        prune(c);
        return true;
      });
    }
    prune(state.root);
    if (clip && clip.cutId && !MMModel.findNode(state.root, clip.cutId)) clip = null;
    state.multiSel.clear();
    state.sel = state.root.id;
    render();
  }

  function marqueeRect() {
    return document.querySelector('.marquee-rect');
  }

  function finishMarquee(e) {
    const rect = canvas.getBoundingClientRect();
    const x1 = (Math.min(marquee.x0, e.clientX) - rect.left - state.pan.x) / state.zoom;
    const y1 = (Math.min(marquee.y0, e.clientY) - rect.top - state.pan.y) / state.zoom;
    const x2 = (Math.max(marquee.x0, e.clientX) - rect.left - state.pan.x) / state.zoom;
    const y2 = (Math.max(marquee.y0, e.clientY) - rect.top - state.pan.y) / state.zoom;
    const picked = [];
    MMModel.walk(state.root, (n) => {
      const p = state.pos.get(n.id);
      const s = state.sizes.get(n.id);
      if (!p || !s) return;
      if (p.x < x2 && p.x + s.w > x1 && p.y < y2 && p.y + s.h > y1) picked.push(n.id);
    });
    state.multiSel = new Set(picked);
    if (picked.length) state.sel = picked[picked.length - 1];
    render();
  }

  async function addNodeImage(id, dataUrl) {
    const A = api();
    if (!A) { toast('桥接未就绪', true); return false; }
    if (!state.path) { toast('请先保存导图（Ctrl+S），再粘贴图片', true); return false; }
    const n = MMModel.findNode(state.root, id);
    if (!n) return false;
    const m = String(dataUrl || '').match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
    if (!m) { toast('剪贴板内容不是图片', true); return false; }
    const ext = m[1].toLowerCase() === 'jpg' ? 'jpeg' : m[1].toLowerCase();
    const res = await A.add_image(state.path, m[2], ext);
    if (!res || !res.ok) { toast('粘贴图片失败：' + ((res && res.error) || '未知错误'), true); return false; }
    pushUndo();
    n.img = res.name;
    n.imgdata = res.data;
    render();
    await doSave(false, true);
    toast('已粘贴图片并保存到文件');
    return true;
  }

  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(bin);
  }

  const FILE_SIZE_CAP = 100 * 1024 * 1024;

  async function pasteFilesIntoNode(id, files) {
    const A = api();
    if (!A) { toast('桥接未就绪', true); return false; }
    if (!state.path) { toast('请先保存导图（Ctrl+S），再粘贴文件', true); return false; }
    const n = MMModel.findNode(state.root, id);
    if (!n) return false;
    const added = [];
    for (const f of files) {
      if (f.size > FILE_SIZE_CAP) { toast('文件 ' + f.name + ' 超过 100MB，已跳过', true); continue; }
      const buf = await f.arrayBuffer();
      const res = await A.add_attachment_data(state.path, f.name, bufToB64(buf));
      if (!res || !res.ok) { toast('附件插入失败：' + ((res && res.error) || '未知错误'), true); continue; }
      added.push({ name: res.name, data: res.data });
    }
    if (!added.length) return false;
    pushUndo();
    if (!n.attach) n.attach = [];
    n.attach.push(...added);
    n.text = added[0].name;
    render();
    await doSave(false, true);
    toast('已粘贴附件 ' + added.map((a) => a.name).join('、') + ' 并保存到文件');
    return true;
  }

  function bindPasteImage() {
    window.addEventListener('paste', (e) => {
      const cd = e.clipboardData;
      const items = (cd && cd.items) || [];
      const fileList = (cd && cd.files) ? Array.from(cd.files) : [];
      const hasRealFile = fileList.length > 0 && fileList.some((f) => f.name !== 'image.png');
      if (hasRealFile) {
        if (state.editing) commitEdit(true);
        if (!state.sel) return;
        e.preventDefault();
        pasteFilesIntoNode(state.sel, fileList);
        return;
      }
      let hasImage = false;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) { hasImage = true; break; }
      }
      if (!hasImage) return;
      if (state.editing) commitEdit(true);
      if (!state.sel) return;
      e.preventDefault();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type && it.type.indexOf('image/') === 0) {
          const f = it.getAsFile();
          if (!f) return;
          const rd = new FileReader();
          rd.onload = () => { addNodeImage(state.sel, rd.result); };
          rd.readAsDataURL(f);
          return;
        }
      }
    });
  }

  function closeAttachPopup() {
    if (attachPopEl) { attachPopEl.remove(); attachPopEl = null; }
    document.removeEventListener('mousedown', attachPopOutside, true);
  }

  function attachPopOutside(e) {
    if (attachPopEl && !attachPopEl.contains(e.target)) closeAttachPopup();
  }

  function openAttachPopup(nodeId, e) {
    closeAttachPopup();
    select(nodeId);
    const n = MMModel.findNode(state.root, nodeId);
    if (!n) return;
    const pop = document.createElement('div');
    pop.id = 'attach-pop';
    const head = document.createElement('div');
    head.className = 'ap-head';
    head.textContent = '附件';
    pop.appendChild(head);
    const atts = n.attach || [];
    if (!atts.length) {
      const empty = document.createElement('div');
      empty.className = 'ap-empty';
      empty.textContent = '暂无附件';
      pop.appendChild(empty);
    }
    atts.forEach((a, idx) => {
      const row = document.createElement('div');
      row.className = 'ap-item';
      const nm = document.createElement('span');
      nm.className = 'ap-name';
      nm.textContent = a.name;
      nm.title = '点击打开：' + a.name;
      nm.addEventListener('click', () => { closeAttachPopup(); openAttachment(a); });
      const del = document.createElement('span');
      del.className = 'ap-del';
      del.textContent = '\u00d7';
      del.title = '移除附件引用';
      del.addEventListener('click', (ev) => {
        ev.stopPropagation();
        removeAttachmentOn(nodeId, idx);
        if (!(n.attach || []).length) closeAttachPopup();
      });
      row.appendChild(nm);
      row.appendChild(del);
      pop.appendChild(row);
    });
    const add = document.createElement('div');
    add.className = 'ap-add';
    add.textContent = '插入附件 (Ctrl+I)';
    add.addEventListener('click', () => { closeAttachPopup(); addAttachment(); });
    pop.appendChild(add);
    document.body.appendChild(pop);
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    pop.style.left = Math.min(e.clientX + 4, window.innerWidth - pw - 8) + 'px';
    pop.style.top = Math.min(e.clientY + 4, window.innerHeight - ph - 8) + 'px';
    attachPopEl = pop;
    setTimeout(() => document.addEventListener('mousedown', attachPopOutside, true), 0);
  }

  function showHelp() {
    $('help-modal').classList.remove('hidden');
  }

  function hideHelp() {
    $('help-modal').classList.add('hidden');
  }

  function closeCtxMenu() {
    const m = $('ctx-menu');
    if (m) m.classList.add('hidden');
  }

  function ctxVisible() {
    const m = $('ctx-menu');
    return m && !m.classList.contains('hidden');
  }

  function openCtxMenu(x, y) {
    const m = $('ctx-menu');
    const n = state.sel ? MMModel.findNode(state.root, state.sel) : null;
    if (!m || !n) return;
    const isRoot = n.id === state.root.id;
    const hasKids = (n.children || []).length > 0;
    const setDis = (act, dis) => {
      const b = m.querySelector('[data-act="' + act + '"]');
      if (b) b.classList.toggle('disabled', !!dis);
    };
    setDis('sibling', isRoot);
    setDis('cut', isRoot);
    setDis('del', isRoot);
    setDis('collapse', !hasKids);
    setDis('paste', !clip);
    setDis('attach-save', !(n.attach && n.attach.length));
    m.classList.remove('hidden');
    m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
  }

  function ctxAction(act) {
    closeCtxMenu();
    if (!state.sel) return;
    switch (act) {
      case 'child': addChild(state.sel); break;
      case 'sibling': addSibling(state.sel); break;
      case 'edit': startEdit(state.sel); break;
      case 'collapse': toggleCollapse(state.sel); break;
      case 'cut': cutNode(state.sel); break;
      case 'copy': copyNode(state.sel); break;
      case 'paste': pasteNode(state.sel); break;
      case 'attach': addAttachment(); break;
      case 'attach-save': saveAttachmentAs(state.sel); break;
      case 'del': deleteNode(state.sel); break;
    }
  }

  function bindToolbar() {
    const bind = (id, fn) => $(id).addEventListener('click', fn);
    bind('btn-new', doNew);
    bind('btn-open', () => doOpen());
    bind('btn-save', () => doSave(false));
    bind('btn-saveas', () => doSave(true));
    bind('btn-add-child', () => state.sel && addChild(state.sel));
    bind('btn-add-sibling', () => state.sel && addSibling(state.sel));
    bind('btn-edit', () => state.sel && startEdit(state.sel));
    bind('btn-delete', () => state.sel && deleteNode(state.sel));
    bind('btn-collapse-all', collapseAll);
    bind('btn-expand-all', expandAll);
    bind('btn-undo', undo);
    bind('btn-redo', redo);
    bind('btn-zoom-in', () => zoomStep(1.2));
    bind('btn-zoom-out', () => zoomStep(1 / 1.2));
    bind('btn-zoom-reset', () => setZoom(1));
    bind('btn-fit', fitView);
    bind('btn-track', toggleTrack);
    bind('btn-optimize', optimizeSizes);
    bind('btn-export-png', exportPNG);
    bind('btn-help', showHelp);
    bind('btn-attach', addAttachment);
    bind('modal-help-close', hideHelp);
    document.querySelectorAll('#ctx-menu .ctx-item').forEach((b) => {
      b.addEventListener('click', () => ctxAction(b.dataset.act));
    });
    $('help-modal').addEventListener('mousedown', (e) => {
      if (e.target === $('help-modal')) hideHelp();
    });
    $('sel-layout').addEventListener('change', (e) => setLayout(e.target.value));
    $('sel-theme').addEventListener('change', (e) => setTheme(e.target.value));
    chkBold.addEventListener('change', () => applyStyle((n) => { n.bold = chkBold.checked; }));
    chkItalic.addEventListener('change', () => applyStyle((n) => { n.it = chkItalic.checked; }));
    chkUnderline.addEventListener('change', () => applyStyle((n) => { n.ul = chkUnderline.checked; }));
    $('btn-style-clear').addEventListener('click', () => {
      applyStyle((n) => {
        n.bg = '';
        n.color = '';
        n.bold = false;
        n.fs = 0;
        n.it = false;
        n.ul = false;
      });
      toast('已清除该节点样式');
    });
    selFontsize.addEventListener('change', () => {
      const v = parseInt(selFontsize.value, 10) || 0;
      applyStyle((n) => { n.fs = v; });
    });
    let latexTimer = null;
    inpLatex.addEventListener('input', () => {
      if (latexTimer) clearTimeout(latexTimer);
      latexTimer = setTimeout(() => {
        latexTimer = null;
        if (!state.sel) return;
        const n = MMModel.findNode(state.root, state.sel);
        if (!n) return;
        const v = inpLatex.value.trim();
        if ((n.latex || '') === v) return;
        applyNodeStyle(state.sel, (nd) => { nd.latex = v; });
      }, 400);
    });
    inpLatex.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (latexTimer) { clearTimeout(latexTimer); latexTimer = null; }
        if (!state.sel) return;
        const n = MMModel.findNode(state.root, state.sel);
        if (!n) return;
        const v = inpLatex.value.trim();
        if ((n.latex || '') === v) return;
        applyNodeStyle(state.sel, (nd) => { nd.latex = v; });
      }
      e.stopPropagation();
    });
    $('modal-ok').addEventListener('click', () => settleModal(true));
    $('modal-cancel').addEventListener('click', () => settleModal(false));
    modalEl.addEventListener('mousedown', (e) => { if (e.target === modalEl) settleModal(false); });
    const rangeInp = $('inp-track-range');
    if (rangeInp) {
      rangeInp.addEventListener('change', () => setTrackRange(rangeInp.value));
      rangeInp.addEventListener('keydown', (e) => e.stopPropagation());
    }
    const zoomInp = $('inp-track-zoom');
    if (zoomInp) {
      zoomInp.addEventListener('change', () => setTrackZoom(zoomInp.value));
      zoomInp.addEventListener('keydown', (e) => e.stopPropagation());
    }
  }

  function bindCanvas() {
    window.addEventListener('resize', () => {
      if (trackPopup.open) renderTrackPopup();
    });
    window.addEventListener('mousedown', (e) => {
      if (trackPopup.open && e.target && !(e.target.closest && e.target.closest('#track-pop'))) closeTrackPopup();
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('.mm-node') || e.target.closest('.mm-toggle') || state.editing) return;
      panDrag = { x: e.clientX, y: e.clientY };
      canvas.classList.add('panning');
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 2 || state.editing) return;
      if (e.target.closest('.mm-node') || e.target.closest('.mm-toggle') || e.target.closest('.mm-attach-badge') || e.target.closest('.rs-handle')) return;
      marquee = { x0: e.clientX, y0: e.clientY, active: false };
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (marquee) {
        if (!marquee.active && Math.abs(e.clientX - marquee.x0) + Math.abs(e.clientY - marquee.y0) > 5) {
          marquee.active = true;
          let el = marqueeRect();
          if (!el) {
            el = document.createElement('div');
            el.className = 'marquee-rect';
            canvas.appendChild(el);
          }
          el.style.display = '';
        }
        if (marquee.active) {
          const el = marqueeRect();
          if (el) {
            const rect = canvas.getBoundingClientRect();
            el.style.left = Math.min(marquee.x0, e.clientX) - rect.left + 'px';
            el.style.top = Math.min(marquee.y0, e.clientY) - rect.top + 'px';
            el.style.width = Math.abs(e.clientX - marquee.x0) + 'px';
            el.style.height = Math.abs(e.clientY - marquee.y0) + 'px';
          }
        }
      }
      if (!panDrag) return;
      state.pan.x += e.clientX - panDrag.x;
      state.pan.y += e.clientY - panDrag.y;
      panDrag = { x: e.clientX, y: e.clientY };
      applyView();
    });
    window.addEventListener('mouseup', (e) => {
      if (marquee) {
        if (marquee.active) {
          finishMarquee(e);
          marqueeSuppressed = true;
          setTimeout(() => { marqueeSuppressed = false; }, 200);
        }
        const el = marqueeRect();
        if (el) el.remove();
        marquee = null;
      }
      if (panDrag) { panDrag = null; canvas.classList.remove('panning'); }
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      closeCtxMenu();
      const rect = canvas.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    nodesLayer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (marqueeSuppressed) return;
      const nodeEl = e.target.closest('.mm-node');
      if (!nodeEl || !nodeEl.dataset.id || state.editing) { closeCtxMenu(); return; }
      select(nodeEl.dataset.id);
      openCtxMenu(e.clientX, e.clientY);
    });
    document.addEventListener('mousedown', (e) => {
      const m = $('ctx-menu');
      if (m && !m.classList.contains('hidden') && !m.contains(e.target)) closeCtxMenu();
    }, true);
    window.addEventListener('blur', closeCtxMenu);
    nodesLayer.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || state.editing) return;
      if (e.target.closest('.rs-handle')) {
        const nodeEl = e.target.closest('.mm-node');
        if (nodeEl && nodeEl.dataset.id) startResize(e, nodeEl.dataset.id, e.target.dataset.mode);
        return;
      }
      if (e.target.closest('.mm-toggle')) return;
      if (e.target.closest('.mm-attach-badge')) return;
      const nodeEl = e.target.closest('.mm-node');
      if (nodeEl && nodeEl.dataset.id) startNodeDrag(e, nodeEl.dataset.id);
    });
    nodesLayer.addEventListener('dblclick', (e) => {
      if (e.target.closest('.mm-toggle')) return;
      if (e.target.closest('.mm-attach-badge')) return;
      if (e.target.closest('.rs-handle')) return;
      const nodeEl = e.target.closest('.mm-node');
      if (nodeEl && nodeEl.dataset.id) startEdit(nodeEl.dataset.id);
    });
    nodesLayer.addEventListener('click', (e) => {
      const badge = e.target.closest('.mm-attach-badge');
      if (badge && badge.dataset.id) { closeCtxMenu(); openAttachPopup(badge.dataset.id, e); return; }
      const tgl = e.target.closest('.mm-toggle');
      if (tgl && tgl.dataset.id) toggleCollapse(tgl.dataset.id);
    });
  }

  function bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.key === 'F1') {
        e.preventDefault();
        if ($('help-modal').classList.contains('hidden')) showHelp(); else hideHelp();
        return;
      }
      if (trackPopup.open) {
        handleTrackPopupKey(e);
        return;
      }
      if (e.key === 'Escape') {
        if (find.open) { e.preventDefault(); closeFind(); return; }
        if (ctxVisible()) { e.preventDefault(); closeCtxMenu(); return; }
        closeAttachPopup();
      }
      if (e.key === 'Escape' && !$('help-modal').classList.contains('hidden')) {
        hideHelp();
        return;
      }
      if (state.editing) return;
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl) {
        const k = e.key.toLowerCase();
        if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (k === 'y') { e.preventDefault(); redo(); }
        else if (k === 's') { e.preventDefault(); doSave(false); }
        else if (k === 'o') { e.preventDefault(); doOpen(); }
        else if (k === 'n') { e.preventDefault(); doNew(); }
        else if (k === 'i' && e.shiftKey) { e.preventDefault(); addAttachment(); }
        else if (k === 'b') { e.preventDefault(); toggleNodeFlag('bold'); }
        else if (k === 'i') { e.preventDefault(); toggleNodeFlag('it'); }
        else if (k === 'x') { e.preventDefault(); if (state.sel) cutNode(state.sel); }
        else if (k === 'c') { e.preventDefault(); if (state.sel) copyNode(state.sel); }
        else if (k === 'v') {
          if (clip) { e.preventDefault(); if (state.sel) pasteNode(state.sel); }
        }
        else if (k === 't') { e.preventDefault(); addTab(); }
        else if (k === 'w') { e.preventDefault(); closeTab(activeTab); }
        else if (k === 'tab') { e.preventDefault(); if (tabs.length > 1) switchTab((activeTab + 1) % tabs.length); }
        else if (k === '=' || k === '+') { e.preventDefault(); zoomStep(1.2); }
        else if (k === '-') { e.preventDefault(); zoomStep(1 / 1.2); }
        else if (k === '0') { e.preventDefault(); setZoom(1); }
        else if (k === 'f') { e.preventDefault(); openFind(false); }
        else if (k === 'h') { e.preventDefault(); openFind(true); }
        return;
      }
      switch (e.key) {
        case 'Tab':
        case 'Insert':
          e.preventDefault();
          if (state.sel) addChild(state.sel);
          break;
        case 'Enter':
          e.preventDefault();
          if (state.sel) addSibling(state.sel);
          break;
        case 'Delete':
          e.preventDefault();
          if (state.multiSel.size > 1) deleteNodes([...state.multiSel]);
          else if (state.sel) deleteNode(state.sel);
          break;
        case 'F2':
          e.preventDefault();
          if (state.sel) startEdit(state.sel);
          break;
        case 'F3':
          e.preventDefault();
          gotoMatch(1);
          break;
        case 'F4':
          e.preventDefault();
          toggleTrack();
          break;
        case ' ':
          e.preventDefault();
          if (state.sel) toggleCollapse(state.sel);
          break;
        case 'ArrowUp':
          e.preventDefault(); navVertical(-1); break;
        case 'ArrowDown':
          e.preventDefault(); navVertical(1); break;
        case 'ArrowLeft':
          e.preventDefault(); navHoriz(-1); break;
        case 'ArrowRight':
          e.preventDefault(); navHoriz(1); break;
      }
    });
  }

  function pollStartup() {
    let tries = 0;
    const timer = setInterval(async () => {
      tries++;
      if (state.startupConsumed || tries > 100) { clearInterval(timer); return; }
      const A = api();
      if (!A || !A.take_startup_file) return;
      try {
        const p = await A.take_startup_file();
        state.startupConsumed = true;
        clearInterval(timer);
        if (p) doOpen(p);
      } catch (err) { /* retry next tick */ }
    }, 300);
  }

  function boot() {
    buildSwatches();
    bindToolbar();
    bindCanvas();
    bindKeys();
    bindPasteImage();
    bindFindBar();
    MMRender.onImageLoad(() => { render(); });
    MMRender.setLegacyImageResolver(async (mapPath, rel) => {
      const A = api();
      if (!A || !mapPath) return null;
      const res = await A.read_image_data(mapPath, rel);
      return res && res.ok ? ('data:' + res.mime + ';base64,' + res.data) : null;
    });
    newMap('中心主题');
    pollStartup();
  }

  window.__MM__ = {
    state: state,
    MMModel: MMModel,
    MMRender: MMRender,
    render: render,
    select: select,
    addChild: addChild,
    addSibling: addSibling,
    deleteNode: deleteNode,
    moveNode: moveNode,
    toggleCollapse: toggleCollapse,
    collapseAll: collapseAll,
    expandAll: expandAll,
    setNodeText: setNodeText,
    applyNodeStyle: applyNodeStyle,
    startEdit: startEdit,
    commitEdit: commitEdit,
    undo: undo,
    redo: redo,
    setZoom: setZoom,
    setPan: setPan,
    centerView: centerView,
    fitView: fitView,
    toggleTrack: toggleTrack,
    setTrackRange: setTrackRange,
    getTrackPopup: () => ({
      open: trackPopup.open,
      side: trackPopup.side,
      buffer: trackPopup.buffer,
      left: trackPopup.lists ? trackPopup.lists.left.length : 0,
      right: trackPopup.lists ? trackPopup.lists.right.length : 0,
    }),
    setTrackZoom: setTrackZoom,
    newMap: newMap,
    loadDoc: loadDoc,
    setTheme: setTheme,
    setLayout: setLayout,
    applyTheme: applyTheme,
    showHelp: showHelp,
    hideHelp: hideHelp,
    copyNode: copyNode,
    cutNode: cutNode,
    pasteNode: pasteNode,
    getClip: () => clip,
    setNodeSize: setNodeSize,
    optimizeSizes: optimizeSizes,
    applyLevelSizes: applyLevelSizes,
    renderMapToDataURL: renderMapToDataURL,
    exportPNG: exportPNG,
    toggleNodeFlag: toggleNodeFlag,
    addTab: addTab,
    closeTab: closeTab,
    switchTab: switchTab,
    getTabs: () => ({ count: tabs.length, active: activeTab, names: tabs.map((t, i) => tabTitle(t, i === activeTab)) }),
    openCtxMenu: openCtxMenu,
    closeCtxMenu: closeCtxMenu,
    ctxVisible: ctxVisible,
    openAttachPopup: openAttachPopup,
    closeAttachPopup: closeAttachPopup,
    addNodeImage: addNodeImage,
    bindPasteImage: bindPasteImage,
    pasteFilesIntoNode: pasteFilesIntoNode,
    saveAttachmentAs: saveAttachmentAs,
    bufToB64: bufToB64,
    openFind: openFind,
    closeFind: closeFind,
    runSearch: runSearch,
    gotoMatch: gotoMatch,
    replaceCurrent: replaceCurrent,
    replaceAll: replaceAll,
    bindFindBar: bindFindBar,
    doSave: doSave,
    cleanTree: () => MMModel.cleanTree(state.root),
    bindKeys: bindKeys,
    bindToolbar: bindToolbar,
    bindCanvas: bindCanvas
  };

  function isSelfTest() {
    return /[#&?]selftest=1/.test(location.hash + location.search);
  }

  function runSelfTest() {
    const r = {};
    try {
      const M = window.__MM__;
      const Model = M.MMModel;
      M.bindKeys();
      M.bindToolbar();
      M.bindCanvas();
      M.bindPasteImage();
      M.bindFindBar();
      r.structCanvas = !!(document.getElementById('canvas') && document.getElementById('viewport') && document.getElementById('edgeG'));
      r.structToolbar = document.querySelectorAll('.toolbar .tb-btn').length >= 14;
      r.structSidebar = !!document.getElementById('sidebar') && !!document.getElementById('bg-swatches');
      M.newMap('中心主题');
      const root = M.state.root;
      const a = Model.createNode('分支一');
      const b = Model.createNode('分支二');
      root.children.push(a, b);
      a.children.push(Model.createNode('子节点 A1'), Model.createNode('子节点 A2'));
      b.children.push(Model.createNode('子节点 B1'));
      M.render();
      r.mapRendered = document.querySelectorAll('.mm-node').length === 6;
      r.rootText = (document.querySelector('.mm-node.root .mm-node-text') || {}).textContent === '中心主题';
      const rootElFs = (document.querySelector('.mm-node.root .mm-node-text') || {}).style || {};
      r.levelFontRoot = rootElFs.fontSize === '18px';
      const kidElFs = (M.MMRender.getNodeEl(a.id).querySelector('.mm-node-text') || {}).style || {};
      r.levelFontChild = kidElFs.fontSize === '16px';
      const grandElFs = (M.MMRender.getNodeEl(a.children[0].id).querySelector('.mm-node-text') || {}).style || {};
      r.levelFontGrand = grandElFs.fontSize === '15px';
      r.edgesRendered = document.querySelectorAll('#edgeG path').length === 5;
      const uniq = new Set();
      M.state.pos.forEach((p) => uniq.add(p.x.toFixed(1) + ',' + p.y.toFixed(1)));
      r.layoutPositions = uniq.size === 6 && M.state.pos.size === 6;
      M.toggleCollapse(b.id);
      r.collapseHides = document.querySelectorAll('.mm-node.hidden').length === 1 && b.collapsed === true;
      M.toggleCollapse(b.id);
      r.expandRestores = document.querySelectorAll('.mm-node.hidden').length === 0;
      const c0 = Model.countNodes(M.state.root);
      M.addChild(root.id, { edit: false });
      r.addChildOp = Model.countNodes(M.state.root) === c0 + 1;
      const newChild = root.children[root.children.length - 1];
      M.setNodeText(newChild.id, '写入 <b>文本</b> & "引号"');
      const el = M.MMRender.getNodeEl(newChild.id);
      r.textSetExact = el.querySelector('.mm-node-text').textContent === '写入 <b>文本</b> & "引号"';
      r.textNotHtml = el.querySelector('.mm-node-text b') === null;
      M.undo();
      r.undoRestoresText = Model.findNode(M.state.root, newChild.id).text === '新节点';
      M.redo();
      r.redoRestoresText = Model.findNode(M.state.root, newChild.id).text.indexOf('<b>') >= 0;
      M.deleteNode(newChild.id);
      r.deleteOp = Model.countNodes(M.state.root) === c0;
      const root2 = M.state.root;
      const a2 = Model.findNode(root2, a.id);
      const b2 = Model.findNode(root2, b.id);
      const b1 = b2.children[0];
      M.moveNode(b1.id, a2.id, 0);
      r.moveNodeOp = Model.findParent(M.state.root, b1.id) === a2;
      M.moveNode(b1.id, b2.id, 0);
      M.state.sel = a2.id;
      let probe = false;
      const probeFn = () => { probe = true; };
      window.addEventListener('keydown', probeFn, { once: true });
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true }));
      r.kbdProbeDocument = probe;
      let probe2 = false;
      window.addEventListener('keydown', () => { probe2 = true; }, { once: true });
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true }));
      r.kbdProbeWindow = probe2;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      r.kbdTabAddsChild = Model.findNode(M.state.root, a2.id).children.length === 3;
      M.commitEdit(true);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      r.kbdEnterAddsSibling = Model.findNode(M.state.root, a2.id).children.length === 4;
      M.commitEdit(true);
      const delId = M.state.sel;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      r.kbdDeleteRemoves = Model.findNode(M.state.root, delId) === null;
      M.setZoom(1.5);
      r.zoomApplied = document.getElementById('viewport').style.transform.indexOf('scale(1.5)') >= 0;
      M.setPan(120, 80);
      r.panApplied = document.getElementById('viewport').style.transform.indexOf('translate(120px, 80px)') >= 0;
      M.fitView();
      r.fitWorks = M.state.zoom > 0 && M.state.zoom <= 1.2;
      M.applyNodeStyle(root2.id, (n) => { n.bg = '#e8f0fe'; n.bold = true; });
      r.styleApplied = M.state.root.bg === '#e8f0fe' && M.state.root.bold === true;
      M.state.sel = M.state.root.id;
      M.render();
      M.startEdit(M.state.root.id, true);
      const editInput = document.querySelector('.mm-edit-input');
      const editEl = M.MMRender.getNodeEl(M.state.root.id);
      r.editInputBgFollowsNode = !!editInput && editInput.style.backgroundColor === editEl.style.backgroundColor;
      r.editInputColorFollowsNode = !!editInput && editInput.style.color === editEl.style.color;
      M.commitEdit(false);
      const snap = JSON.parse(JSON.stringify(M.cleanTree()));
      r.snapshotHasRoot = snap.text === '中心主题' && Array.isArray(snap.children);
      M.state.root.bg = '';
      M.render();
      M.setTheme('dark');
      const bgDark = document.querySelector('.mm-node.root').style.backgroundColor;
      r.themeSwitch = M.state.theme === 'dark' && bgDark !== '';
      M.setTheme('default');
      r.themeSwitchBack = document.querySelector('.mm-node.root').style.backgroundColor !== bgDark;
      const tree = M.state.root;
      const kids0 = tree.children;
      const rp0 = () => M.state.pos.get(tree.id);
      const cp0 = () => M.state.pos.get(kids0[0].id);
      M.setLayout('org-down');
      r.layoutOrgDown = M.state.layout === 'org-down' && cp0().y > rp0().y;
      M.setLayout('tree-right');
      r.layoutTreeRight = cp0().x > rp0().x && cp0().y > rp0().y;
      M.setLayout('map-right');
      r.layoutMapRight = cp0().x > rp0().x + M.state.sizes.get(tree.id).w;
      M.setLayout('timeline');
      const aCol = M.state.pos.get(kids0[0].children[0].id);
      const bCol = M.state.pos.get(kids0[1].children[0].id);
      const aCy = aCol ? aCol.y + M.state.sizes.get(kids0[0].children[0].id).h / 2 : 99;
      const bCy = bCol ? bCol.y + M.state.sizes.get(kids0[1].children[0].id).h / 2 : -99;
      r.layoutTimeline = M.state.layout === 'timeline' && !!M.state.decor && !!M.state.decor.axis && aCy < 0 && bCy > 0;
      M.setLayout('fishbone');
      r.layoutFishbone = M.state.layout === 'fishbone' && !!M.state.decor && !!M.state.decor.bones && M.state.decor.bones.length === 2 && M.state.links && M.state.links.size >= 2;
      M.setLayout('map-balance');
      const rw = M.state.sizes.get(tree.id).w;
      r.layoutBalanceBack = Math.abs(rp0().x + rw / 2) < 0.5;
      M.state.sel = tree.id;
      tree.attach = [{ name: '演示.pdf', rel: 'demo.pdf' }];
      M.render();
      r.attachPanelRenders = document.querySelectorAll('#attach-list .attach-item').length === 1;
      const badge = document.querySelector('.mm-node.root .mm-attach-badge');
      r.attachBadgeShows = !!badge && badge.style.display !== 'none' && badge.textContent.indexOf('\ud83d\udcce') === 0;
      M.openAttachPopup(tree.id, { clientX: 200, clientY: 200 });
      r.attachPopupOpens = !!document.getElementById('attach-pop');
      r.attachPopupItem = document.querySelectorAll('#attach-pop .ap-item').length === 1;
      M.closeAttachPopup();
      tree.attach = [];
      M.render();
      r.attachPanelEmpty = document.querySelectorAll('#attach-list .attach-empty').length === 1;
      r.attachBadgeHides = !document.querySelector('.mm-node.root .mm-attach-badge') ||
        document.querySelector('.mm-node.root .mm-attach-badge').style.display === 'none';
      const kids2 = M.state.root.children;
      const nKids0 = kids2.length;
      M.state.sel = kids2[0].id;
      M.render();
      r.attachPanelFollowsSel = document.querySelectorAll('#attach-list .attach-empty').length === 1;
      const ctxTarget = kids2[0];
      const ctxEl = M.MMRender.getNodeEl(ctxTarget.id);
      ctxEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
      r.ctxMenuOpens = M.ctxVisible();
      r.ctxItemsCount = document.querySelectorAll('#ctx-menu .ctx-item').length === 10;
      r.ctxDelEnabled = !document.querySelector('#ctx-menu [data-act="del"]').classList.contains('disabled');
      M.closeCtxMenu();
      M.select(M.state.root.id);
      M.render();
      const rootEl = M.MMRender.getNodeEl(M.state.root.id);
      rootEl.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 }));
      r.ctxRootDelDisabled = document.querySelector('#ctx-menu [data-act="del"]').classList.contains('disabled');
      r.ctxRootSiblingDisabled = document.querySelector('#ctx-menu [data-act="sibling"]').classList.contains('disabled');
      r.ctxPasteDisabledWhenEmpty = document.querySelector('#ctx-menu [data-act="paste"]').classList.contains('disabled');
      r.ctxRootAttachSaveDisabled = document.querySelector('#ctx-menu [data-act="attach-save"]').classList.contains('disabled');
      r.ctxAttachEnabled = !document.querySelector('#ctx-menu [data-act="attach"]').classList.contains('disabled');
      document.querySelector('#ctx-menu [data-act="child"]').click();
      M.commitEdit(false);
      r.ctxAddChildWorks = M.MMModel.findNode(M.state.root, M.state.root.id).children.length === nKids0 + 1;
      const preCopy = M.MMModel.countNodes(M.state.root);
      M.copyNode(ctxTarget.id);
      r.clipCopied = !!M.getClip() && M.getClip().cutId === null;
      M.select(M.state.root.id);
      M.pasteNode(M.state.root.id);
      M.commitEdit(false);
      r.clipPasteClones = M.MMModel.countNodes(M.state.root) === preCopy + M.MMModel.countNodes(ctxTarget);
      const cutChild = M.MMModel.findNode(M.state.root, ctxTarget.id).children[0];
      if (cutChild) {
        M.cutNode(cutChild.id);
        r.cutMarksNode = M.getClip() && M.getClip().cutId === cutChild.id;
        M.select(M.state.root.children[M.state.root.children.length - 1].id);
        M.pasteNode(M.state.sel);
        r.cutPasteMoves = M.MMModel.findParent(M.state.root, cutChild.id) === M.state.root.children[M.state.root.children.length - 1];
      } else {
        r.cutMarksNode = false;
        r.cutPasteMoves = false;
      }
      const cntTab0 = M.MMModel.countNodes(M.state.root);
      M.addTab();
      r.tabAdds = M.getTabs().count === 2 && M.getTabs().active === 1;
      M.addChild(M.state.root.id, { edit: false });
      M.commitEdit(false);
      const cntTab1 = M.MMModel.countNodes(M.state.root);
      r.tabNewTabEditable = cntTab1 === 2;
      M.switchTab(0);
      r.tabSwitchPreservesOld = M.getTabs().active === 0 && M.MMModel.countNodes(M.state.root) === cntTab0;
      M.switchTab(1);
      r.tabSwitchPreservesNew = M.getTabs().active === 1 && M.MMModel.countNodes(M.state.root) === cntTab1;
      r.tabDomRenders = document.querySelectorAll('#tabbar .tab').length === 2;
      r.tabActiveHighlight = document.querySelector('#tabbar .tab.active').dataset.idx === '1';
      M.state.modified = false;
      M.closeTab(1);
      r.tabCloses = M.getTabs().count === 1 && M.getTabs().active === 0 && M.MMModel.countNodes(M.state.root) === cntTab0;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, bubbles: true, cancelable: true }));
      M.commitEdit(false);
      r.tabCtrlT = M.getTabs().count === 2;
      M.closeTab(M.getTabs().active);
      r.tabCtrlTBack = M.getTabs().count === 1 && M.getTabs().active === 0;
      const szTarget = M.state.root.children[0];
      M.setNodeSize(szTarget.id, 200, 60);
      const szEl = M.MMRender.getNodeEl(szTarget.id);
      r.nodeSizeApplied = szEl.style.width === '200px' && szEl.style.height === '60px';
      r.nodeSizeClass = szEl.classList.contains('sized');
      r.nodeSizeModel = (() => { const nn = Model.findNode(M.state.root, szTarget.id); return nn.w === 200 && nn.h === 60; })();
      M.undo();
      r.nodeSizeUndo = Model.findNode(M.state.root, szTarget.id).w === 0;
      M.redo();
      r.nodeSizeRedo = Model.findNode(M.state.root, szTarget.id).w === 200;
      M.setNodeSize(M.state.root.id, 300, 80);
      r.edgesAfterSize = document.querySelectorAll('#edgeG path').length >= 5;
      M.setNodeSize(M.state.root.id, 0, 0);
      M.setNodeSize(szTarget.id, 0, 0);
      const longNode = Model.createNode('这是一个非常长的节点文本用来测试一键优化尺寸功能是否能够正确换行并且不会溢出容器边界');
      M.state.root.children.push(longNode);
      M.render();
      M.optimizeSizes();
      r.optimizeLongWrapped = longNode.w > 0 && longNode.w <= 260 && longNode.h >= 40;
      r.optimizeRootSized = M.state.root.w >= 150 && M.state.root.h >= 40;
      r.optimizeEdges = document.querySelectorAll('#edgeG path').length >= 6;
      M.deleteNode(longNode.id);
      const fmtNode = Model.createNode('格式节点');
      M.state.root.children.push(fmtNode);
      M.select(fmtNode.id);
      M.applyNodeStyle(fmtNode.id, (n) => { n.fs = 20; n.it = true; n.ul = true; });
      const fmtEl = M.MMRender.getNodeEl(fmtNode.id);
      r.fmtFontsize = fmtEl.querySelector('.mm-node-text').style.fontSize === '20px';
      r.fmtItalicClass = fmtEl.classList.contains('italic');
      r.fmtUnderlineClass = fmtEl.classList.contains('underline');
      M.applyNodeStyle(fmtNode.id, (n) => { n.latex = '\\frac{a}{b}'; });
      const fmtEl2 = M.MMRender.getNodeEl(fmtNode.id);
      r.latexRendered = fmtEl2.querySelector('.mm-latex').innerHTML.indexOf('mx-frac') >= 0;
      r.latexVisible = fmtEl2.querySelector('.mm-latex').style.display !== 'none';
      r.latexHasClass = fmtEl2.classList.contains('has-latex');
      M.select(fmtNode.id);
      r.panelItalicSync = document.getElementById('chk-italic').checked === true;
      r.panelUnderlineSync = document.getElementById('chk-underline').checked === true;
      r.panelFontsizeSync = document.getElementById('sel-fontsize').value === '20';
      r.panelLatexSync = document.getElementById('inp-latex').value === '\\frac{a}{b}';
      document.getElementById('btn-style-clear').click();
      r.clearStyleResets = fmtNode.fs === 0 && fmtNode.it === false && fmtNode.ul === false && fmtNode.bg === '' && fmtNode.color === '';
      M.applyNodeStyle(fmtNode.id, (n) => { n.latex = ''; });
      r.latexCleared = M.MMRender.getNodeEl(fmtNode.id).querySelector('.mm-latex').style.display === 'none';
      M.deleteNode(fmtNode.id);
      const lvlRoot = Model.createNode('层级根');
      const lvl1 = Model.createNode('一级节点');
      const lvl2 = Model.createNode('二级节点');
      lvl1.children.push(lvl2);
      lvlRoot.children.push(lvl1);
      M.state.root.children.push(lvlRoot);
      M.render();
      M.applyLevelSizes();
      r.levelRootLargest = lvlRoot.fs > lvl1.fs && lvl1.fs > lvl2.fs && lvlRoot.w > lvl1.w && lvl1.w > lvl2.w;
      r.levelRootHeight = lvlRoot.h >= 64;
      const lvlSnap = { w: lvl2.w, h: lvl2.h, fs: lvl2.fs };
      M.applyLevelSizes();
      r.levelIdempotent = lvl2.w === lvlSnap.w && lvl2.h === lvlSnap.h && lvl2.fs === lvlSnap.fs;
      M.select(lvl2.id);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
      r.ctrlBBold = lvl2.bold === true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
      r.ctrlBUnbold = lvl2.bold === false;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }));
      r.ctrlIItalic = lvl2.it === true;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', ctrlKey: true, bubbles: true, cancelable: true }));
      r.ctrlIUnitalic = lvl2.it === false;
      M.startEdit(lvl2.id, true);
      const editInp2 = document.querySelector('.mm-edit-input');
      editInp2.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
      r.editCtrlBBold = lvl2.bold === true;
      M.commitEdit(false);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
      r.editCtrlBUnbold = lvl2.bold === false;
      const pngTiny = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const imgNode = Model.createNode('内嵌图');
      imgNode.img = '粘贴图片.png';
      imgNode.imgdata = pngTiny;
      M.state.root.children.push(imgNode);
      M.render();
      const imgEl2 = M.MMRender.getNodeEl(imgNode.id);
      const imgDom = imgEl2.querySelector('.mm-node-img');
      r.embedImgDataSrc = imgDom.getAttribute('src').indexOf('data:image/png;base64,') === 0;
      r.embedImgClass = imgEl2.classList.contains('has-img');
      imgNode.attach = [{ name: '打包.rar', data: 'aGVsbG8=' }];
      M.render();
      r.attachDataKept = JSON.stringify(M.cleanTree().children.find((c) => c.id === imgNode.id).attach[0]).indexOf('"data":"aGVsbG8="') >= 0;
      M.state.root.children.pop();
      M.render();
      r.dpiSelectExists = !!document.getElementById('sel-export-dpi') &&
        document.querySelectorAll('#sel-export-dpi option').length === 3;
      r.bufToB64Roundtrip = M.bufToB64(new Uint8Array([1, 2, 3, 255])) === 'AQID/w==';
      M.select(imgNode.id);
      const evNoClip = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
      r.ctrlVNativeWhenNoClip = document.dispatchEvent(evNoClip) === true;
      M.copyNode(M.state.root.id);
      const evWithClip = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
      r.ctrlVCancelsWithClip = document.dispatchEvent(evWithClip) === false;
      M.undo();
      M.showHelp();
      r.helpModalOpens = !document.getElementById('help-modal').classList.contains('hidden');
      M.hideHelp();
      r.helpModalCloses = document.getElementById('help-modal').classList.contains('hidden');
    } catch (e) {
      r.error = String((e && e.stack) || e);
    }
    const finish = () => {
      const keys = Object.keys(r).filter((k) => k !== 'error');
      r.total = keys.length > 0 && keys.every((k) => r[k] === true) && !r.error;
      window.__SELFTEST__ = r;
      document.title = 'SELFTEST:' + (r.total ? 'PASS' : 'FAIL');
    };
    (async () => {
      try {
        const MM = window.__MM__;
        if (window.pywebview && window.pywebview.api) {
          window.pywebview.api.get_save_path = async () => null;
        }
        MM.openFind(false);
        r.findBarOpens = !document.getElementById('find-bar').classList.contains('hidden');
        const inpF = document.getElementById('inp-find');
        inpF.value = '子节点';
        inpF.dispatchEvent(new Event('input'));
        const cntTxt1 = document.getElementById('find-count').textContent;
        r.findCountFormat = /^\d+\/\d+$/.test(cntTxt1);
        r.findHitsMarked = document.querySelectorAll('.mm-node.find-hit').length >= 2;
        const totalHits = parseInt(cntTxt1.split('/')[1], 10);
        r.findCountTotal = totalHits >= 3;
        for (let i = 0; i < totalHits; i++) document.getElementById('btn-find-next').click();
        r.findWraps = document.getElementById('find-count').textContent === '1/' + totalHits;
        document.getElementById('chk-word').checked = true;
        inpF.dispatchEvent(new Event('input'));
        const cntWord = document.getElementById('find-count').textContent;
        r.findWordOption = /^\d+\/\d+$/.test(cntWord) || cntWord === '无匹配';
        document.getElementById('chk-word').checked = false;
        inpF.dispatchEvent(new Event('input'));
        inpF.value = '';
        inpF.dispatchEvent(new Event('input'));
        r.findEmptyHint = document.getElementById('find-count').textContent === '请输入关键词';
        inpF.value = '绝对不存在的词xyzq';
        inpF.dispatchEvent(new Event('input'));
        r.findNoMatchHint = document.getElementById('find-count').textContent === '无匹配';
        inpF.value = '子节点';
        inpF.dispatchEvent(new Event('input'));
        document.getElementById('inp-replace').value = '模块';
        document.getElementById('btn-replace-all').click();
        await new Promise((res) => setTimeout(res, 60));
        r.findConfirmShown = !document.getElementById('modal').classList.contains('hidden');
        document.getElementById('modal-ok').click();
        await new Promise((res) => setTimeout(res, 100));
        r.replaceAllWorks = JSON.stringify(MM.cleanTree()).indexOf('子节点') < 0;
        r.findCountAfterReplace = document.getElementById('find-count').textContent === '无匹配';
        MM.closeFind();
        r.findCloseClears = document.querySelectorAll('.mm-node.find-hit').length === 0;
        const lvlRoot2 = MM.MMModel.findNode(MM.state.root, MM.state.root.id).children.find((c) => c.text === '层级根');
        const lvl1b = lvlRoot2.children[0];
        MM.select(lvlRoot2.id);
        const url = await MM.renderMapToDataURL(2);
        r.exportPngDataUrl = typeof url === 'string' && url.indexOf('data:image/png;base64,') === 0 && url.length > 2000;
        MM.toggleCollapse(lvl1b.id);
        const url2 = await MM.renderMapToDataURL(2);
        r.exportPngIncludesCollapsed = typeof url2 === 'string' && url2.indexOf('data:image/png;base64,') === 0 && url2.length > 2000;
        r.collapsedRestored = lvl1b.collapsed === true;
        MM.toggleCollapse(lvl1b.id);
        const cvEl = document.getElementById('canvas');
        const cvRect = cvEl.getBoundingClientRect();
        const mkMouse = (type, x, y, btn) => new MouseEvent(type, { button: btn, buttons: btn, clientX: x, clientY: y, bubbles: true, cancelable: true });
        const someKid = MM.state.root.children[0];
        const ax = cvRect.left + MM.state.pan.x + (-5000) * MM.state.zoom;
        const ay = cvRect.top + MM.state.pan.y + (-5000) * MM.state.zoom;
        cvEl.dispatchEvent(mkMouse('mousedown', ax, ay, 2));
        window.dispatchEvent(mkMouse('mousemove', ax + 40000, ay + 40000, 2));
        window.dispatchEvent(mkMouse('mouseup', ax + 40000, ay + 40000, 2));
        r.marqueeSelects = MM.state.multiSel.size >= 2;
        const cntBeforeMarquee = MMModel.countNodes(MM.state.root);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
        r.marqueeBatchDelete = MMModel.countNodes(MM.state.root) === 1 && MM.state.multiSel.size === 0;
        const tdoc = { name: '追踪测试', root: { text: '追踪根', children: [] } };
        for (let i = 1; i <= 24; i++) {
          const short = i % 2 === 0;
          tdoc.root.children.push({
            text: short ? ('短节点' + i) : ('追踪分支节点' + i + '号内容较长用于撑大整体布局范围的测试文本'),
            children: short ? [] : [{ text: '孙辈节点' + i + '号内容也要足够长以便向两侧继续撑出视口范围' }]
          });
        }
        MM.loadDoc(tdoc);
        MM.select(MM.state.root.id);
        MM.toggleTrack();
        r.trackTogglesOn = MM.state.trackMode === true;
        r.trackBtnActive = document.getElementById('btn-track').classList.contains('active');
        const selEl = MM.MMRender.getNodeEl(MM.state.sel);
        r.trackSelFullScaled = (selEl.style.opacity === '' || parseFloat(selEl.style.opacity) >= 0.99)
          && selEl.style.transform.indexOf('scale(1.5)') >= 0;
        let scaledOthers = 0;
        document.querySelectorAll('.mm-node').forEach((el) => {
          if (el.dataset.id !== MM.state.sel && el.style.transform.indexOf('scale') >= 0) scaledOthers++;
        });
        r.trackScaleOnlySel = scaledOthers === 0;
        const circEl = document.getElementById('track-circle');
        r.trackCircleShown = !!circEl && !circEl.classList.contains('hidden')
          && parseFloat(circEl.style.width) > 0;
        let midCnt = 0;
        let ghostCnt = 0;
        let minOp = 1;
        let orphanCnt = 0;
        const opMap = new Map();
        document.querySelectorAll('.mm-node').forEach((el) => {
          const o = el.style.opacity === '' ? 1 : parseFloat(el.style.opacity);
          opMap.set(el.dataset.id, o);
          if (o < 0.04) ghostCnt++;
          else if (o < 0.99) midCnt++;
          if (el.dataset.id !== MM.state.sel && o < minOp) minOp = o;
        });
        MMModel.walk(MM.state.root, (n, parent) => {
          const o = opMap.get(n.id) || 0;
          if (o >= 0.5) {
            const pOk = parent && (opMap.get(parent.id) || 0) >= 0.1;
            const cOk = (n.children || []).some((c) => (opMap.get(c.id) || 0) >= 0.1);
            if (!pOk && !cOk) orphanCnt++;
          }
        });
        r.trackBandFades = midCnt > 0;
        r.trackFarFaint = minOp < 0.3;
        r.trackNoOrphans = orphanCnt === 0;
        const rangeInp2 = document.getElementById('inp-track-range');
        const zoomInp2 = document.getElementById('inp-track-zoom');
        r.trackInputsExist = !!rangeInp2 && !!zoomInp2;
        zoomInp2.value = '2';
        zoomInp2.dispatchEvent(new Event('change'));
        r.trackZoomApplies = selEl.style.transform.indexOf('scale(2)') >= 0;
        zoomInp2.value = '1.5';
        zoomInp2.dispatchEvent(new Event('change'));
        const fadedAt = () => {
          let g = 0;
          document.querySelectorAll('.mm-node').forEach((el) => {
            const op = el.style.opacity === '' ? 1 : parseFloat(el.style.opacity);
            if (op < 0.99) g++;
          });
          return g;
        };
        const faded65 = midCnt + ghostCnt;
        rangeInp2.value = '100';
        rangeInp2.dispatchEvent(new Event('change'));
        const faded100 = fadedAt();
        rangeInp2.value = '30';
        rangeInp2.dispatchEvent(new Event('change'));
        const faded30 = fadedAt();
        r.trackRangeScales = faded100 < faded65 && faded30 > faded65;
        rangeInp2.value = '5';
        rangeInp2.dispatchEvent(new Event('change'));
        r.trackRangeClampLow = MM.state.trackRange === 20;
        rangeInp2.value = '65';
        rangeInp2.dispatchEvent(new Event('change'));
        MM.setLayout('timeline');
        MM.setLayout('map-balance');
        r.trackEdgesAfterRelayout = document.querySelectorAll('#edgeG path').length >= 24;
        MM.select(MM.state.root.id);
        const popDoc = { name: '弹窗测试', root: { text: '弹窗根节点', children: [{ text: '锚点格子A', children: [] }] } };
        for (let i = 1; i <= 20; i++) popDoc.root.children[0].children.push({ text: '子格' + i + '号内容' });
        MM.loadDoc(popDoc);
        const anchorId = MM.state.root.children[0].id;
        MM.select(anchorId);
        r.selOnTop = getComputedStyle(MM.MMRender.getNodeEl(MM.state.sel)).zIndex === '30';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        const pop1 = MM.getTrackPopup();
        r.trackPopOpens = pop1.open && pop1.side === 'right' && pop1.right === 20 && pop1.left === 1;
        r.trackPopBadges = document.querySelectorAll('#track-pop .tp-badge').length === 21
          && document.querySelectorAll('#track-pop .tp-node').length === 22
          && !document.getElementById('track-pop').classList.contains('hidden');
        const popEl = document.getElementById('track-pop');
        const popRatio = popEl.offsetWidth / popEl.offsetHeight;
        r.trackPopSizing = Math.abs(popRatio - 1.618) < 0.05
          && popEl.offsetHeight / window.innerHeight > 0.5
          && popEl.offsetHeight <= window.innerHeight - 20;
        let phiOk = true;
        let sideW = 0;
        let cenW = 0;
        document.querySelectorAll('#track-pop .tp-node').forEach((el) => {
          if (Math.abs(el.offsetWidth / el.offsetHeight - 1.618) > 0.06) phiOk = false;
          if (el.classList.contains('center')) cenW = el.offsetWidth; else sideW = el.offsetWidth;
        });
        r.trackPopCellsPhi = phiOk && sideW > 0 && cenW > 0
          && Math.abs((cenW / sideW) - 1.618) < 0.1;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '1', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true, cancelable: true }));
        r.trackPopBuffer = MM.getTrackPopup().buffer === '15';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        r.trackPopJump15 = MM.state.sel !== anchorId
          && MM.MMModel.findNode(MM.state.root, MM.state.sel).text === '子格15号内容'
          && MM.MMRender.getNodeEl(MM.state.sel).classList.contains('selected')
          && !MM.getTrackPopup().open;
        MM.select(anchorId);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        r.trackPopSingleLeft = MM.state.sel === MM.state.root.id
          && !MM.getTrackPopup().open
          && document.getElementById('track-pop').classList.contains('hidden');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        r.trackPopSingleRight = MM.state.sel === anchorId && !MM.getTrackPopup().open;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '9', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        r.trackPopOutOfRange = MM.getTrackPopup().open && MM.state.sel === anchorId;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        r.trackPopEscCloses = !MM.getTrackPopup().open;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
        r.trackPopCrossSingle = MM.state.sel === MM.state.root.id && !MM.getTrackPopup().open;
        MM.select(anchorId);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
        document.getElementById('canvas').dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        r.trackPopOutsideCloses = !MM.getTrackPopup().open;
        MM.select(MM.state.root.id);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F4', bubbles: true, cancelable: true }));
        let cleared = true;
        document.querySelectorAll('.mm-node').forEach((el) => {
          if (el.style.opacity !== '' || el.style.transform.indexOf('scale') >= 0) cleared = false;
        });
        r.trackF4OffRestores = MM.state.trackMode === false && cleared;
      } catch (e2) {
        r.exportPngDataUrl = false;
        r.exportPngError = String((e2 && e2.stack) || e2).slice(0, 300);
      }
      finish();
    })();
  }

  if (isSelfTest()) {
    document.addEventListener('DOMContentLoaded', () => {
      requestAnimationFrame(() => requestAnimationFrame(runSelfTest));
    }, { once: true });
  } else {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  }
})();
