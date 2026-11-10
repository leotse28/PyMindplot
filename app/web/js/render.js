(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';
  const FALLBACK_L1 = ['#4285f4', '#ea4335', '#fbbc05', '#34a853', '#9334e6', '#00acc1', '#ff6d00', '#7cb342'];
  const LEVEL_FONTS = [18, 16, 15, 14, 13];

  const THEMES = {
    default: {
      name: '默认蓝', canvas: '#f4f6fb', dot: '#d4dae8',
      rootBg: '#2f6fed', rootFg: '#ffffff',
      nodeBg: '#ffffff', nodeFg: '#2b3245', nodeBorder: '#d6dbe6',
      edge: '#a7b0c3',
      l1: FALLBACK_L1
    },
    minimal: {
      name: '极简白', canvas: '#fafafa', dot: '#e4e4e4',
      rootBg: '#37474f', rootFg: '#ffffff',
      nodeBg: '#ffffff', nodeFg: '#333333', nodeBorder: '#e0e0e0',
      edge: '#b8bcc4',
      l1: ['#607d8b', '#78909c', '#455a64', '#90a4ae', '#546e7a', '#7f8c8d', '#607d8b', '#78909c']
    },
    dark: {
      name: '暗黑', canvas: '#1e2229', dot: '#2b303b',
      rootBg: '#4f8cff', rootFg: '#ffffff',
      nodeBg: '#2b3240', nodeFg: '#dfe4ef', nodeBorder: '#3d4454',
      edge: '#5a6478',
      l1: ['#5c9dff', '#ff7b72', '#ffd166', '#7bd88f', '#c792ea', '#4dd0e1', '#ffa94d', '#a3d977']
    },
    warm: {
      name: '暖橙', canvas: '#fdf6ee', dot: '#ecdcc8',
      rootBg: '#ef6c00', rootFg: '#ffffff',
      nodeBg: '#ffffff', nodeFg: '#4e342e', nodeBorder: '#ecd9c5',
      edge: '#c8a27a',
      l1: ['#ef6c00', '#f4a22b', '#d84315', '#c99b5f', '#b3652c', '#e8a04c', '#ad6d43', '#f0b95c']
    },
    forest: {
      name: '森绿', canvas: '#f2f7f2', dot: '#d5e5d5',
      rootBg: '#2e7d32', rootFg: '#ffffff',
      nodeBg: '#ffffff', nodeFg: '#273b29', nodeBorder: '#cfe0cf',
      edge: '#8fae91',
      l1: ['#2e7d32', '#558b2f', '#00897b', '#6b9b37', '#33691e', '#4c8c4a', '#2f7d5d', '#79a860']
    },
    violet: {
      name: '紫青', canvas: '#f6f4fb', dot: '#ded8ee',
      rootBg: '#5e35b1', rootFg: '#ffffff',
      nodeBg: '#ffffff', nodeFg: '#372a4d', nodeBorder: '#ddd3ef',
      edge: '#a996cd',
      l1: ['#5e35b1', '#7e57c2', '#3949ab', '#9575cd', '#00838f', '#6746c3', '#5c6bc0', '#8e6fd8']
    }
  };

  let nodesLayer = null;
  let edgeG = null;
  const nodeEls = new Map();
  let onImageLoadCb = null;
  let legacyImageResolver = null;
  const legacyImgCache = new Map();

  function init() {
    nodesLayer = document.getElementById('nodes');
    edgeG = document.getElementById('edgeG');
  }

  function themeOf(st) {
    return THEMES[st.theme] || THEMES.default;
  }

  function imgUrl(st, rel) {
    const m = String(st.path || '');
    const r = String(rel || '');
    if (!m || !r) return '';
    const dot = m.lastIndexOf('.');
    const base = dot > 0 ? m.slice(0, dot) : m;
    const dir = (base + '.assets').replace(/\\/g, '/');
    const enc = dir.split('/').map(function (seg) {
      return /^[A-Za-z]:$/.test(seg) ? seg : encodeURIComponent(seg);
    }).join('/');
    return 'file:///' + enc + '/' + encodeURIComponent(r);
  }

  function imgMime(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
      gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
      svg: 'image/svg+xml' }[ext] || 'image/png';
  }

  function imgSrc(st, n) {
    const data = String(n.imgdata || '');
    if (data) return 'data:' + imgMime(n.img) + ';base64,' + data;
    return imgUrl(st, n.img);
  }

  function createEl(n) {
    const el = document.createElement('div');
    el.className = 'mm-node';
    el.dataset.id = n.id;
    const t = document.createElement('div');
    t.className = 'mm-node-text';
    const tx = document.createElement('div');
    tx.className = 'mm-latex';
    tx.style.display = 'none';
    const im = document.createElement('img');
    im.className = 'mm-node-img';
    im.style.display = 'none';
    im.alt = '';
    const tg = document.createElement('div');
    tg.className = 'mm-toggle';
    tg.style.display = 'none';
    const ab = document.createElement('span');
    ab.className = 'mm-attach-badge';
    ab.style.display = 'none';
    const re = document.createElement('span');
    re.className = 'rs-handle rs-e';
    re.dataset.mode = 'e';
    const rs = document.createElement('span');
    rs.className = 'rs-handle rs-s';
    rs.dataset.mode = 's';
    const rse = document.createElement('span');
    rse.className = 'rs-handle rs-se';
    rse.dataset.mode = 'se';
    el.appendChild(t);
    el.appendChild(tx);
    el.appendChild(im);
    el.appendChild(tg);
    el.appendChild(ab);
    el.appendChild(re);
    el.appendChild(rs);
    el.appendChild(rse);
    nodesLayer.appendChild(el);
    return el;
  }

  function syncNodes(st) {
    const th = themeOf(st);
    const seen = new Set();
    function rec(n, parent, hidden, depth) {
      seen.add(n.id);
      let el = nodeEls.get(n.id);
      if (!el) {
        el = createEl(n);
        nodeEls.set(n.id, el);
      }
      el.classList.toggle('hidden', hidden);
      el.classList.toggle('root', n === st.root);
      el.classList.toggle('bold', !!n.bold);
      el.classList.toggle('italic', !!n.it);
      el.classList.toggle('underline', !!n.ul);
      el.classList.toggle('selected', st.sel === n.id || !!(st.multiSel && st.multiSel.has(n.id)));
      const t = el.querySelector('.mm-node-text');
      if (t.textContent !== n.text) t.textContent = n.text;
      const d = depth || 0;
      if (n.fs > 0) t.style.fontSize = n.fs + 'px';
      else t.style.fontSize = (LEVEL_FONTS[Math.min(d, LEVEL_FONTS.length - 1)]) + 'px';
      const isRoot = n === st.root;
      el.style.backgroundColor = n.bg || (isRoot ? th.rootBg : th.nodeBg);
      el.style.color = n.color || (isRoot ? th.rootFg : th.nodeFg);
      el.style.borderColor = isRoot ? 'transparent' : th.nodeBorder;
      if (n.w > 0) el.style.width = n.w + 'px'; else el.style.width = '';
      if (n.h > 0) el.style.height = n.h + 'px'; else el.style.height = '';
      el.classList.toggle('sized', n.w > 0 || n.h > 0);
      const tx = el.querySelector('.mm-latex');
      const latex = String(n.latex || '').trim();
      if (latex) {
        if (el.dataset.latex !== latex) {
          tx.innerHTML = (window.MiniMath ? MiniMath.render(latex) : '');
          el.dataset.latex = latex;
        }
        tx.style.display = '';
      } else {
        tx.style.display = 'none';
        tx.innerHTML = '';
        delete el.dataset.latex;
      }
      const im = el.querySelector('.mm-node-img');
      const imgRel = String(n.img || '').trim();
      const imgData = String(n.imgdata || '').trim();
      if (imgRel || imgData) {
        let url;
        if (imgData) {
          url = imgSrc(st, n);
        } else {
          const key = String(st.path || '') + '|' + imgRel;
          url = legacyImgCache.get(key) || imgUrl(st, imgRel);
          if (!legacyImgCache.has(key) && typeof legacyImageResolver === 'function') {
            legacyImageResolver(st.path, imgRel).then((dataUrl) => {
              if (!dataUrl) return;
              legacyImgCache.set(key, dataUrl);
              const elNow = nodeEls.get(n.id);
              const imNow = elNow && elNow.querySelector('.mm-node-img');
              if (imNow && imNow.dataset.rel === imgRel) {
                imNow.src = dataUrl;
                imNow.dataset.src = dataUrl;
                if (typeof onImageLoadCb === 'function') onImageLoadCb(n.id);
              }
            }).catch(() => {});
          }
        }
        if (im.dataset.src !== url) {
          im.dataset.src = url;
          im.dataset.rel = imgRel;
          im.src = url;
          im.onload = function () {
            if (typeof onImageLoadCb === 'function') onImageLoadCb(n.id);
          };
        }
        im.style.display = '';
      } else {
        im.style.display = 'none';
        im.removeAttribute('src');
        delete im.dataset.src;
        delete im.dataset.rel;
      }
      el.classList.toggle('has-latex', !!latex);
      el.classList.toggle('has-img', !!(imgRel || imgData));
      const hasKids = (n.children || []).length > 0;
      const tg = el.querySelector('.mm-toggle');
      if (hasKids) {
        tg.style.display = '';
        tg.dataset.id = n.id;
        tg.textContent = n.collapsed ? String(MMModel.descendantCount(n)) : '\u2212';
      } else {
        tg.style.display = 'none';
      }
      const ab = el.querySelector('.mm-attach-badge');
      const atts = Array.isArray(n.attach) ? n.attach : [];
      if (atts.length) {
        ab.style.display = '';
        ab.dataset.id = n.id;
        ab.textContent = '\ud83d\udcce' + (atts.length > 1 ? String(atts.length) : '');
        ab.title = atts.length + ' 个附件，点击查看';
      } else {
        ab.style.display = 'none';
        delete ab.dataset.id;
      }
      (n.children || []).forEach(function (c) {
        rec(c, n, hidden || !!n.collapsed, (depth || 0) + 1);
      });
    }
    rec(st.root, null, false);
    nodeEls.forEach(function (el, id) {
      if (!seen.has(id)) {
        el.remove();
        nodeEls.delete(id);
      }
    });
  }

  function measure(st) {
    const sizes = new Map();
    nodeEls.forEach(function (el, id) {
      if (el.classList.contains('hidden')) return;
      sizes.set(id, { w: el.offsetWidth, h: el.offsetHeight });
    });
    st.sizes = sizes;
    return sizes;
  }

  function applyPositions(st, layout) {
    nodeEls.forEach(function (el, id) {
      if (el.classList.contains('hidden')) return;
      const p = layout.pos.get(id);
      if (!p) return;
      el.style.transform = 'translate(' + p.x + 'px, ' + p.y + 'px)';
      const side = layout.sides.get(id) || 'right';
      const tg = el.querySelector('.mm-toggle');
      if (tg) {
        tg.classList.toggle('side-right', side === 'right');
        tg.classList.toggle('side-left', side === 'left');
        tg.classList.toggle('side-top', side === 'top');
        tg.classList.toggle('side-bottom', side === 'bottom');
      }
    });
  }

  function nodeBox(st, id) {
    const p = st.pos.get(id);
    const s = st.sizes.get(id);
    if (!p || !s) return null;
    return { x: p.x, y: p.y, w: s.w, h: s.h };
  }

  function addPath(d, color, width) {
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(width));
    edgeG.appendChild(path);
    return path;
  }

  function addLine(x1, y1, x2, y2, color, width) {
    return addPath('M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2, color, width);
  }

  function buildEdgeList(st, layout) {
    const out = [];
    const th = themeOf(st);
    const mode = st.layout || 'map-balance';
    const rootBox = nodeBox(st, st.root.id);
    if (!rootBox) return out;

    if (mode === 'fishbone' && layout.decor && layout.decor.spine) {
      const sp = layout.decor.spine;
      out.push({ d: 'M ' + sp.x1 + ' ' + sp.y1 + ' L ' + sp.x2 + ' ' + sp.y2, color: th.edge, width: 3 });
    }
    if (mode === 'timeline' && layout.decor && layout.decor.axis) {
      const ax = layout.decor.axis;
      out.push({ d: 'M ' + ax.x1 + ' ' + ax.y1 + ' L ' + ax.x2 + ' ' + ax.y2, color: th.edge, width: 2 });
    }
    if (mode === 'fishbone' && layout.decor && layout.decor.bones) {
      layout.decor.bones.forEach(function (b) {
        out.push({ d: 'M ' + b.x1 + ' ' + b.y1 + ' L ' + b.x2 + ' ' + b.y2, color: th.l1[b.index % th.l1.length], width: 2.5 });
      });
    }

    function rec(n, branchIndex) {
      if (n.collapsed) return;
      const kids = n.children || [];
      const pBox = nodeBox(st, n.id);
      if (!pBox) return;
      const isRootKids = n === st.root;
      kids.forEach(function (c, i) {
        const cBox = nodeBox(st, c.id);
        if (!cBox) return;
        const bIdx = isRootKids ? i : branchIndex;
        let color;
        if (mode === 'fishbone') {
          color = th.l1[bIdx % th.l1.length];
        } else {
          color = isRootKids ? th.l1[bIdx % th.l1.length] : th.edge;
        }
        const width = isRootKids ? 2.5 : 2;
        const to = (st.trackMode && st.trackOp && st.trackOp.size) ? st.trackOp : null;
        let op = 1;
        if (to) {
          const oP = to.get(n.id) === undefined ? 1 : to.get(n.id);
          const oC = to.get(c.id) === undefined ? 1 : to.get(c.id);
          op = Math.min(oP, oC);
          if (oP < 0.04 || oC < 0.04) op = Math.max(op, 0.35 * Math.max(oP, oC));
        }
        if (op > 0.01 && !(mode === 'fishbone' && isRootKids)) {
          out.push(edgePathFor(mode, n, c, pBox, cBox, color, width, layout, st, op));
        }
        rec(c, bIdx);
      });
    }
    rec(st.root, 0);
    return out;
  }

  function edgePathFor(mode, p, c, pBox, cBox, color, width, layout, st, op) {
    if (mode === 'fishbone') {
      const link = layout.links ? layout.links.get(c.id) : null;
      if (link && link.kind === 'rib') {
        return { opacity: op === undefined ? 1 : op, d: 'M ' + (cBox.x + cBox.w) + ' ' + (cBox.y + cBox.h / 2) + ' L ' + link.ax + ' ' + link.ay, color: color, width: 2 };
      }
      return { opacity: op === undefined ? 1 : op, d: MMLayout.edgePathElbowTB(pBox.x + pBox.w / 2, pBox.y + pBox.h, cBox.x + cBox.w / 2, cBox.y), color: color, width: width };
    }
    if (mode === 'org-down') {
      return { opacity: op === undefined ? 1 : op, d: MMLayout.edgePathElbowTB(pBox.x + pBox.w / 2, pBox.y + pBox.h, cBox.x + cBox.w / 2, cBox.y), color: color, width: width };
    }
    if (mode === 'tree-right') {
      return { opacity: op === undefined ? 1 : op, d: MMLayout.edgePathElbowRL(pBox.x + 18, pBox.y + pBox.h, cBox.x, cBox.y + cBox.h / 2), color: color, width: width };
    }
    if (mode === 'timeline') {
      const childAbove = cBox.y + cBox.h / 2 < pBox.y + pBox.h / 2;
      const px = pBox.x + Math.min(24, pBox.w / 2);
      const py = childAbove ? pBox.y : pBox.y + pBox.h;
      const cx = cBox.x + Math.min(24, cBox.w / 2);
      const cy = childAbove ? cBox.y + cBox.h : cBox.y;
      return { opacity: op === undefined ? 1 : op, d: MMLayout.edgePathV(px, py, cx, cy), color: color, width: width };
    }
    const side = st.sides.get(c.id) || 'right';
    const s = side === 'left' ? -1 : 1;
    const px = s > 0 ? pBox.x + pBox.w : pBox.x;
    const py = pBox.y + pBox.h / 2;
    const cx = s > 0 ? cBox.x : cBox.x + cBox.w;
    const cy = cBox.y + cBox.h / 2;
    return { opacity: op === undefined ? 1 : op, d: MMLayout.edgePathH(px, py, cx, cy, side), color: color, width: width };
  }

  function drawEdges(st, layout) {
    while (edgeG.firstChild) edgeG.removeChild(edgeG.firstChild);
    buildEdgeList(st, layout).forEach(function (p) {
      const el = addPath(p.d, p.color, p.width);
      if (p.opacity !== undefined && p.opacity < 1) el.setAttribute('stroke-opacity', p.opacity.toFixed(3));
    });
  }

  function render(st) {
    syncNodes(st);
    const sizes = measure(st);
    const layout = MMLayout.computeLayout(st.root, sizes, st.layout || 'map-balance');
    st.pos = layout.pos;
    st.sides = layout.sides;
    st.decor = layout.decor;
    st.links = layout.links;
    applyPositions(st, layout);
    drawEdges(st, layout);
    return layout;
  }

  init();

  window.MMRender = {
    render: render,
    getNodeEl: function (id) { return nodeEls.get(id) || null; },
    onImageLoad: function (cb) { onImageLoadCb = cb; },
    setLegacyImageResolver: function (fn) { legacyImageResolver = fn; },
    imgUrl: imgUrl,
    imgSrc: imgSrc,
    buildEdgeList: buildEdgeList,
    THEMES: THEMES,
    themeOf: themeOf,
    FALLBACK_L1: FALLBACK_L1
  };
})();
