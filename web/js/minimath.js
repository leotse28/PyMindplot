(function () {
  'use strict';

  var SYM = {
    alpha: '\u03b1', beta: '\u03b2', gamma: '\u03b3', delta: '\u03b4', epsilon: '\u03b5',
    varepsilon: '\u03b5', zeta: '\u03b6', eta: '\u03b7', theta: '\u03b8', iota: '\u03b9',
    kappa: '\u03ba', lambda: '\u03bb', mu: '\u03bc', nu: '\u03bd', xi: '\u03be',
    pi: '\u03c0', rho: '\u03c1', sigma: '\u03c3', tau: '\u03c4', upsilon: '\u03c5',
    phi: '\u03c6', varphi: '\u03c6', chi: '\u03c7', psi: '\u03c8', omega: '\u03c9',
    Gamma: '\u0393', Delta: '\u0394', Theta: '\u0398', Lambda: '\u039b', Xi: '\u039e',
    Pi: '\u03a0', Sigma: '\u03a3', Phi: '\u03a6', Psi: '\u03a8', Omega: '\u03a9',
    sum: '\u2211', prod: '\u220f', int: '\u222b', partial: '\u2202', nabla: '\u2207',
    infty: '\u221e', pm: '\u00b1', mp: '\u2213', times: '\u00d7', div: '\u00f7',
    cdot: '\u22c5', ast: '\u2217', star: '\u22c6', circ: '\u2218', bullet: '\u2219',
    leq: '\u2264', le: '\u2264', geq: '\u2265', ge: '\u2265', neq: '\u2260', ne: '\u2260',
    approx: '\u2248', equiv: '\u2261', sim: '\u223c', propto: '\u221d',
    ll: '\u226a', gg: '\u226b',
    leftarrow: '\u2190', Rightarrow: '\u21d2', rightarrow: '\u2192', Leftarrow: '\u21d0',
    leftrightarrow: '\u2194', Leftrightarrow: '\u21d4', uparrow: '\u2191', downarrow: '\u2193',
    mapsto: '\u21a6', implies: '\u21d2', iff: '\u21d4',
    in: '\u2208', notin: '\u2209', ni: '\u220b', subset: '\u2282', supset: '\u2283',
    subseteq: '\u2286', supseteq: '\u2287', emptyset: '\u2205', varnothing: '\u2205',
    cup: '\u222a', cap: '\u2229', setminus: '\u2216', forall: '\u2200', exists: '\u2203',
    neg: '\u00ac', land: '\u2227', lor: '\u2228', oplus: '\u2295', otimes: '\u2297',
    perp: '\u22a5', parallel: '\u2225', angle: '\u2220', triangle: '\u25b3',
    degree: '\u00b0', prime: '\u2032', ell: '\u2113', hbar: '\u210f',
    cdots: '\u22ef', ldots: '\u2026', dots: '\u2026', vdots: '\u22ee', ddots: '\u22f1',
    langle: '\u27e8', rangle: '\u27e9'
  };

  var ROMAN = { lim: 1, log: 1, ln: 1, lg: 1, sin: 1, cos: 1, tan: 1, cot: 1,
    sec: 1, csc: 1, max: 1, min: 1, sup: 1, inf: 1, exp: 1, det: 1, dim: 1,
    mod: 1, gcd: 1, Pr: 1, arg: 1, ker: 1, hom: 1 };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function makeParser(src) {
    var i = 0;
    var n = src.length;

    function peek() { return i < n ? src.charAt(i) : ''; }

    function readRawArg() {
      while (i < n && src.charAt(i) === ' ') i++;
      if (peek() === '{') {
        var depth = 0, j = i;
        for (; i < n; i++) {
          var ch = src.charAt(i);
          if (ch === '{') depth++;
          else if (ch === '}') { depth--; if (depth === 0) { i++; return src.slice(j + 1, i - 1); } }
        }
        return src.slice(j + 1);
      }
      if (peek() === '\\') {
        var j2 = i;
        i++;
        while (i < n && /[a-zA-Z]/.test(src.charAt(i))) i++;
        return src.slice(j2, i);
      }
      return peek() ? src.charAt(i++) : '';
    }

    function renderSeq(stopBrace) {
      var toks = [];

      function atom(html) { toks.push({ t: 'a', h: html }); }

      while (i < n) {
        var c = peek();
        if (c === '}') { i++; if (stopBrace) break; continue; }
        if (c === '^' || c === '_') {
          i++;
          var arg = renderArg(readRawArg());
          toks.push({ t: c === '^' ? 's' : 'b', h: arg });
          continue;
        }
        if (c === '{') { i++; atom(renderSeq(true)); continue; }
        if (c === '\\') {
          i++;
          var j = i;
          while (i < n && /[a-zA-Z]/.test(src.charAt(i))) i++;
          var name = src.slice(j, i);
          if (!name) { atom(esc(peek() ? src.charAt(i++) : '')); continue; }
          if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
            var a = renderArg(readRawArg()), b = renderArg(readRawArg());
            atom('<span class="mx-frac"><span>' + a + '</span><span class="mx-den">' + b + '</span></span>');
            continue;
          }
          if (name === 'sqrt') {
            var idx = '';
            if (peek() === '[') {
              var k = i + 1;
              while (k < n && src.charAt(k) !== ']') k++;
              idx = src.slice(i + 1, k);
              i = (k < n) ? k + 1 : k;
            }
            var body = renderArg(readRawArg());
            var inner = idx ? '<span class="mx-idx">' + idx + '</span>' : '';
            atom('<span class="mx-sqrt"><span class="mx-rad">\u221a</span>' + inner +
              '<span class="mx-vg">' + body + '</span></span>');
            continue;
          }
          if (name === 'text' || name === 'mathrm' || name === 'operatorname' || name === 'mbox') {
            atom('<span class="mx-rm">' + esc(readRawArg()) + '</span>');
            continue;
          }
          if (name === 'mathbf' || name === 'bm' || name === 'boldsymbol') {
            atom('<span class="mx-bf">' + renderArg(readRawArg()) + '</span>');
            continue;
          }
          if (name === 'mathit') { atom('<span class="mx-it">' + renderArg(readRawArg()) + '</span>'); continue; }
          if (name === 'overline' || name === 'bar') {
            atom('<span class="mx-ov">' + renderArg(readRawArg()) + '</span>');
            continue;
          }
          if (name === 'hat') { atom(renderArg(readRawArg()) + '<span class="mx-hat">\u0302</span>'); continue; }
          if (name === 'left' || name === 'right' || name === 'big' || name === 'Big' ||
              name === 'bigg' || name === 'Bigg') {
            if (peek() && peek() !== '\\') i++;
            continue;
          }
          if (name === 'begin' || name === 'end') { readRawArg(); continue; }
          if (name === 'quad') { atom('<span class="mx-spq"></span>'); continue; }
          if (name === 'qquad') { atom('<span class="mx-spqq"></span>'); continue; }
          if (name === ',' || name === ';' || name === ':' || name === '!') {
            atom('<span class="mx-spthin"></span>'); continue;
          }
          if (SYM.hasOwnProperty(name)) { atom('<span class="mx-op">' + SYM[name] + '</span>'); continue; }
          if (ROMAN.hasOwnProperty(name)) { atom('<span class="mx-rm">' + name + '</span>'); continue; }
          atom('<span class="mx-it">' + esc(name) + '</span>');
          continue;
        }
        if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
        atom(esc(src.charAt(i++)));
      }

      var html = '';
      var lastAtomStart = -1;
      for (var k = 0; k < toks.length; k++) {
        var tk = toks[k];
        if (tk.t === 'a') {
          html += tk.h;
          lastAtomStart = html.length - tk.h.length;
          continue;
        }
        var sup = null, sub = null;
        while (k < toks.length && toks[k].t !== 'a') {
          if (toks[k].t === 's') sup = toks[k].h; else sub = toks[k].h;
          k++;
        }
        k--;
        var base = null;
        if (lastAtomStart >= 0) {
          base = html.slice(lastAtomStart);
          html = html.slice(0, lastAtomStart);
          lastAtomStart = -1;
        }
        if (base !== null) {
          if (sup && sub) {
            html += '<span class="mx-subsup"><span class="mx-base">' + base +
              '</span><span class="mx-sup">' + sup + '</span><span class="mx-sub">' + sub + '</span></span>';
          } else if (sup) {
            html += base + '<sup class="mx-s">' + sup + '</sup>';
          } else {
            html += base + '<sub class="mx-s">' + sub + '</sub>';
          }
        } else {
          if (sup) html += '<sup class="mx-s">' + sup + '</sup>';
          if (sub) html += '<sub class="mx-s">' + sub + '</sub>';
        }
      }
      return html;
    }

    function renderArg(raw) {
      if (!raw) return '';
      if (raw.charAt(0) === '\\' && raw.length > 1) return makeParser(raw).parse();
      return esc(raw);
    }

    return { parse: function () { return renderSeq(false); } };
  }

  function render(latex) {
    var src = String(latex || '').trim()
      .replace(/^\$\$(.*)\$\$$/, '$1').replace(/^\\\[(.*)\\\]$/, '$1').replace(/^\\\((.*)\\\)$/, '$1');
    if (!src) return '';
    try {
      return '<span class="mx-math">' + makeParser(src).parse() + '</span>';
    } catch (e) {
      return '<span class="mx-math mx-err">' + esc(src) + '</span>';
    }
  }

  window.MiniMath = { render: render };
})();
