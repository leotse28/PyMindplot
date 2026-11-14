(function () {
  'use strict';

  let idSeq = 0;
  function nid() { return 'n' + (++idSeq); }

  function createNode(text) {
    return {
      id: nid(),
      text: text || '新节点',
      children: [],
      collapsed: false,
      color: '',
      bg: '',
      bold: false,
      fs: 0,
      it: false,
      ul: false,
      latex: '',
      img: '',
      w: 0,
      h: 0
    };
  }

  function assignIds(node) {
    if (!node.id) node.id = nid();
    (node.children || []).forEach(function (c) { assignIds(c); });
    return node;
  }

  function walk(node, cb, parent) {
    cb(node, parent || null);
    (node.children || []).forEach(function (c) { walk(c, cb, node); });
  }

  function findNode(root, id) {
    if (!root || !id) return null;
    if (root.id === id) return root;
    const kids = root.children || [];
    for (let i = 0; i < kids.length; i++) {
      const r = findNode(kids[i], id);
      if (r) return r;
    }
    return null;
  }

  function findParent(root, id) {
    if (!root || !id) return null;
    const kids = root.children || [];
    for (let i = 0; i < kids.length; i++) {
      if (kids[i].id === id) return root;
      const r = findParent(kids[i], id);
      if (r) return r;
    }
    return null;
  }

  function isDescendantOf(node, ancestorId) {
    if (!node || node.id === ancestorId) return false;
    let found = false;
    walk(node, function (n) { if (n.id === ancestorId) found = true; });
    return found;
  }

  function countNodes(node) {
    let k = 1;
    (node.children || []).forEach(function (c) { k += countNodes(c); });
    return k;
  }

  function descendantCount(node) {
    return countNodes(node) - 1;
  }

  function cleanTree(node) {
    return {
      id: node.id,
      text: node.text,
      collapsed: !!node.collapsed,
      color: node.color || '',
      bg: node.bg || '',
      bold: !!node.bold,
      fs: Math.max(0, Math.round(node.fs || 0)),
      it: !!node.it,
      ul: !!node.ul,
      latex: node.latex || '',
      img: node.img || '',
      imgdata: node.imgdata || '',
      w: Math.max(0, Math.round(node.w || 0)),
      h: Math.max(0, Math.round(node.h || 0)),
      attach: (node.attach || []).map(function (a) {
        return { name: a.name, rel: a.rel, data: a.data };
      }),
      children: (node.children || []).map(cleanTree)
    };
  }

  function cloneTree(node) {
    return JSON.parse(JSON.stringify(cleanTree(node)));
  }

  function visibleList(root, isCollapsedFn) {
    const out = [];
    function rec(n, parent, hidden) {
      const selfHidden = hidden || (parent ? isCollapsedFn(parent) : false);
      if (!selfHidden) out.push({ node: n, parent: parent });
      (n.children || []).forEach(function (c) { rec(c, n, selfHidden); });
    }
    rec(root, null, false);
    return out;
  }

  window.MMModel = {
    nid: nid,
    createNode: createNode,
    assignIds: assignIds,
    walk: walk,
    findNode: findNode,
    findParent: findParent,
    isDescendantOf: isDescendantOf,
    countNodes: countNodes,
    descendantCount: descendantCount,
    cleanTree: cleanTree,
    cloneTree: cloneTree,
    visibleList: visibleList
  };
})();
