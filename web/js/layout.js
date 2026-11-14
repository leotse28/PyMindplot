(function () {
  'use strict';

  const GAP_X = 64;
  const GAP_Y = 12;
  const ROOT_GAP_X = 84;
  const VGAP_X = 26;
  const VGAP_Y = 58;
  const TR_INDENT = 46;
  const TR_GAP_Y = 10;
  const TL_GAP_X = 56;
  const TL_GAP_Y = 12;
  const TL_AXIS_GAP = 40;
  const FB_RIB = 26;
  const FB_GAP_Y = 8;
  const FB_BONE_HX = 0.62;
  const FB_BONE_HY = 0.79;
  const FB_MIN_BONE = 100;

  const LAYOUT_MODES = ['map-balance', 'map-right', 'org-down', 'tree-right', 'timeline', 'fishbone'];

  function sizeOf(n, sizes) {
    const s = sizes.get(n.id);
    return s || { w: 130, h: 38 };
  }

  function visibleKids(n) {
    return n.collapsed ? [] : (n.children || []);
  }

  function layoutHorizontal(root, sizes, mode) {
    const pos = new Map();
    const sides = new Map();
    calcH(root, sizes);
    root._x = -root._w / 2;
    root._y = -root._h / 2;
    pos.set(root.id, { x: root._x, y: root._y });
    sides.set(root.id, 'right');
    const kids = root.children || [];
    if (!kids.length) return { pos: pos, sides: sides, decor: null, links: null };
    let groups;
    if (mode === 'map-right') {
      groups = [[kids, 1]];
    } else {
      const rightKids = [];
      const leftKids = [];
      kids.forEach(function (c, i) {
        (i % 2 === 0 ? rightKids : leftKids).push(c);
      });
      groups = [[rightKids, 1], [leftKids, -1]];
    }
    groups.forEach(function (g) {
      const list = g[0];
      const side = g[1];
      if (!list.length) return;
      const conn = side > 0 ? root._x + root._w + ROOT_GAP_X : root._x - ROOT_GAP_X;
      let span = 0;
      list.forEach(function (c) { span += c._th; });
      span += GAP_Y * (list.length - 1);
      let top = -span / 2;
      list.forEach(function (c) {
        placeH(c, side, conn, top, pos, sides);
        top += c._th + GAP_Y;
      });
    });
    return { pos: pos, sides: sides, decor: null, links: null };
  }

  function calcH(n, sizes) {
    const s = sizeOf(n, sizes);
    n._w = s.w;
    n._h = s.h;
    const kids = visibleKids(n);
    if (!kids.length) {
      n._th = n._h;
      return;
    }
    let sum = 0;
    kids.forEach(function (c) {
      calcH(c, sizes);
      sum += c._th;
    });
    sum += GAP_Y * (kids.length - 1);
    n._th = Math.max(n._h, sum);
  }

  function placeH(n, side, connX, top, pos, sides) {
    n._x = side > 0 ? connX : connX - n._w;
    n._y = top + (n._th - n._h) / 2;
    pos.set(n.id, { x: n._x, y: n._y });
    sides.set(n.id, side > 0 ? 'right' : 'left');
    const kids = visibleKids(n);
    if (!kids.length) return;
    let span = 0;
    kids.forEach(function (c) { span += c._th; });
    span += GAP_Y * (kids.length - 1);
    let cy = top + (n._th - span) / 2;
    const outX = side > 0 ? n._x + n._w : n._x;
    kids.forEach(function (c) {
      placeH(c, side, side > 0 ? outX + GAP_X : outX - GAP_X, cy, pos, sides);
      cy += c._th + GAP_Y;
    });
  }

  function calcV(n, sizes) {
    const s = sizeOf(n, sizes);
    n._w = s.w;
    n._h = s.h;
    const kids = visibleKids(n);
    if (!kids.length) {
      n._tw = n._w;
      return;
    }
    let sum = 0;
    kids.forEach(function (c) {
      calcV(c, sizes);
      sum += c._tw;
    });
    sum += VGAP_X * (kids.length - 1);
    n._tw = Math.max(n._w, sum);
  }

  function placeV(n, cx, top, pos, sides) {
    n._x = cx - n._w / 2;
    n._y = top;
    pos.set(n.id, { x: n._x, y: n._y });
    sides.set(n.id, 'bottom');
    const kids = visibleKids(n);
    if (!kids.length) return;
    let span = 0;
    kids.forEach(function (c) { span += c._tw; });
    span += VGAP_X * (kids.length - 1);
    let x = cx - span / 2;
    const childTop = top + n._h + VGAP_Y;
    kids.forEach(function (c) {
      placeV(c, x + c._tw / 2, childTop, pos, sides);
      x += c._tw + VGAP_X;
    });
  }

  function layoutOrgDown(root, sizes) {
    const pos = new Map();
    const sides = new Map();
    calcV(root, sizes);
    placeV(root, 0, -root._h / 2, pos, sides);
    return { pos: pos, sides: sides, decor: null, links: null };
  }

  function layoutTreeRight(root, sizes) {
    const pos = new Map();
    const sides = new Map();
    let y = 0;
    function rec(n, depth) {
      const s = sizeOf(n, sizes);
      n._x = depth * TR_INDENT;
      n._y = y;
      y += s.h + TR_GAP_Y;
      pos.set(n.id, { x: n._x, y: n._y });
      sides.set(n.id, 'right');
      if (n.collapsed) return;
      (n.children || []).forEach(function (c) { rec(c, depth + 1); });
    }
    rec(root, 0);
    return { pos: pos, sides: sides, decor: null, links: null };
  }

  function layoutTimeline(root, sizes) {
    const pos = new Map();
    const sides = new Map();
    const rs = sizeOf(root, sizes);
    root._x = 0;
    root._y = -rs.h / 2;
    pos.set(root.id, { x: root._x, y: root._y });
    sides.set(root.id, 'right');
    let x = rs.w + TL_GAP_X;
    let maxX = rs.w;
    const kids = root.children || [];
    kids.forEach(function (c, i) {
      const cs = sizeOf(c, sizes);
      const above = i % 2 === 0;
      const rows = [];
      if (!c.collapsed) {
        (c.children || []).forEach(function (g) { collectRows(g, 1, rows); });
      }
      let colH = 0;
      rows.forEach(function (r, j) {
        colH += sizeOf(r.n, sizes).h + TL_GAP_Y;
      });
      if (rows.length) colH -= TL_GAP_Y;
      let colW = cs.w;
      rows.forEach(function (r) {
        colW = Math.max(colW, sizeOf(r.n, sizes).w + r.depth * TR_INDENT);
      });
      const sign = above ? -1 : 1;
      c._x = x;
      c._y = -cs.h / 2;
      pos.set(c.id, { x: c._x, y: c._y });
      sides.set(c.id, above ? 'top' : 'bottom');
      let yy;
      if (above) {
        yy = -(TL_AXIS_GAP + colH);
      } else {
        yy = TL_AXIS_GAP;
      }
      const colX = x + cs.w / 2 - colW / 2;
      rows.forEach(function (r) {
        const s2 = sizeOf(r.n, sizes);
        r.n._x = colX + r.depth * TR_INDENT;
        r.n._y = yy;
        yy += s2.h + TL_GAP_Y;
        pos.set(r.n.id, { x: r.n._x, y: r.n._y });
        sides.set(r.n.id, 'right');
      });
      x += Math.max(cs.w, colW) + TL_GAP_X;
      maxX = x - TL_GAP_X;
    });
    const decor = kids.length
      ? { axis: { x1: 0, y1: 0, x2: maxX, y2: 0 } }
      : null;
    return { pos: pos, sides: sides, decor: decor, links: null };
  }

  function collectRows(n, depth, rows) {
    rows.push({ n: n, depth: depth });
    if (n.collapsed) return;
    (n.children || []).forEach(function (g) { collectRows(g, depth + 1, rows); });
  }

  function stackHeight(n, sizes) {
    const s = sizeOf(n, sizes);
    let h = s.h;
    const kids = visibleKids(n);
    if (kids.length) {
      let sub = 0;
      kids.forEach(function (g) { sub += stackHeight(g, sizes); });
      sub += FB_GAP_Y * (kids.length - 1);
      h += sub + FB_GAP_Y;
    }
    return h;
  }

  function placeStack(n, x, y, pos, sides, links) {
    const s = sizeOf(n, sizes0);
    n._x = x;
    n._y = y;
    pos.set(n.id, { x: n._x, y: n._y });
    sides.set(n.id, 'right');
    const kids = visibleKids(n);
    if (!kids.length) return y + s.h;
    let cy = y + s.h + FB_GAP_Y;
    kids.forEach(function (g) {
      cy = placeStack(g, x + 18, cy, pos, sides, links);
      cy += FB_GAP_Y;
    });
    return cy - FB_GAP_Y;
  }

  let sizes0 = null;

  function layoutFishbone(root, sizes) {
    sizes0 = sizes;
    const pos = new Map();
    const sides = new Map();
    const links = new Map();
    const rs = sizeOf(root, sizes);
    root._x = 0;
    root._y = -rs.h / 2;
    pos.set(root.id, { x: root._x, y: root._y });
    sides.set(root.id, 'left');
    const kids = root.children || [];
    const bones = [];
    let attachX = -rs.w / 2 - 46;
    let minAttachX = attachX;
    kids.forEach(function (c, i) {
      const cs = sizeOf(c, sizes);
      const side = i % 2 === 0 ? -1 : 1;
      const rows = [];
      if (!c.collapsed) {
        (c.children || []).forEach(function (g) { rows.push(g); });
      }
      let colH = 0;
      rows.forEach(function (g, j) {
        colH += stackHeight(g, sizes);
      });
      colH += FB_GAP_Y * Math.max(0, rows.length - 1);
      const boneLen = Math.max(FB_MIN_BONE, colH * 1.42);
      const attach = { x: attachX, y: 0 };
      const end = {
        x: attach.x - boneLen * FB_BONE_HX,
        y: attach.y + side * boneLen * FB_BONE_HY
      };
      c._x = end.x - cs.w / 2;
      c._y = end.y - cs.h / 2;
      pos.set(c.id, { x: c._x, y: c._y });
      sides.set(c.id, side < 0 ? 'top' : 'bottom');
      bones.push({ x1: attach.x, y1: attach.y, x2: end.x, y2: end.y, index: i });
      if (rows.length) {
        const n2 = rows.length;
        const spanT = 0.9;
        rows.forEach(function (g, j) {
          const t = spanT * (j + 0.6) / n2;
          const by = attach.y + side * boneLen * FB_BONE_HY * t;
          const bx = attach.x - boneLen * FB_BONE_HX * t;
          links.set(g.id, { kind: 'rib', ax: bx, ay: by, colorIndex: i });
          placeStack(g, bx - FB_RIB - sizeOf(g, sizes).w, by - sizeOf(g, sizes).h / 2, pos, sides, links);
        });
      }
      const extent = boneLen * FB_BONE_HX + FB_RIB + 40;
      let maxRowW = 0;
      rows.forEach(function (g) {
        maxRowW = Math.max(maxRowW, sizeOf(g, sizes).w + 18 + 40);
      });
      attachX = attach.x - extent - maxRowW;
      minAttachX = Math.min(minAttachX, attachX);
    });
    const decor = kids.length
      ? {
        spine: { x1: Math.min(minAttachX - 10, -rs.w / 2 - 46), y1: 0, x2: root._x + 8, y2: 0 },
        bones: bones
      }
      : null;
    return { pos: pos, sides: sides, decor: decor, links: links };
  }

  function computeLayout(root, sizes, mode) {
    switch (mode) {
      case 'map-right': return layoutHorizontal(root, sizes, 'map-right');
      case 'org-down': return layoutOrgDown(root, sizes);
      case 'tree-right': return layoutTreeRight(root, sizes);
      case 'timeline': return layoutTimeline(root, sizes);
      case 'fishbone': return layoutFishbone(root, sizes);
      case 'map-balance':
      default: return layoutHorizontal(root, sizes, 'map-balance');
    }
  }

  function edgePathH(px, py, cx, cy, side) {
    const dx = Math.max(24, Math.abs(cx - px) * 0.45);
    const s = side === 'left' ? -1 : 1;
    return (
      'M ' + px + ' ' + py +
      ' C ' + (px + s * dx) + ' ' + py +
      ', ' + (cx - s * dx) + ' ' + cy +
      ', ' + cx + ' ' + cy
    );
  }

  function edgePathV(px, py, cx, cy) {
    const dy = Math.max(20, Math.abs(cy - py) * 0.45);
    const s = cy < py ? -1 : 1;
    return (
      'M ' + px + ' ' + py +
      ' C ' + px + ' ' + (py + s * dy) +
      ', ' + cx + ' ' + (cy - s * dy) +
      ', ' + cx + ' ' + cy
    );
  }

  function edgePathElbowTB(px, py, cx, cy) {
    const midY = py + (cy - py) / 2;
    return 'M ' + px + ' ' + py + ' L ' + px + ' ' + midY + ' L ' + cx + ' ' + midY + ' L ' + cx + ' ' + cy;
  }

  function edgePathElbowRL(px, py, cx, cy) {
    return 'M ' + px + ' ' + py + ' L ' + px + ' ' + cy + ' L ' + cx + ' ' + cy;
  }

  window.MMLayout = {
    LAYOUT_MODES: LAYOUT_MODES,
    GAP_X: GAP_X,
    GAP_Y: GAP_Y,
    ROOT_GAP_X: ROOT_GAP_X,
    TR_INDENT: TR_INDENT,
    computeLayout: computeLayout,
    edgePathH: edgePathH,
    edgePathV: edgePathV,
    edgePathElbowTB: edgePathElbowTB,
    edgePathElbowRL: edgePathElbowRL
  };
})();
