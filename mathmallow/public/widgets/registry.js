/* Mathmallow widget registry.
 * Each renderer is pure: fn(params) -> SVGElement.
 * Adding a new visual = add one renderer here + one entry in capabilities.json.
 *
 * Exposes window.WIDGETS (name -> fn) and window.renderRender(renderSpec) ->
 * an HTMLElement/SVGElement to drop into the page, handling all four `kind`s
 * plus the image/svg escape hatches and the alt-text fallback.
 */
(function () {
  'use strict';

  const SVGNS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    return el;
  }
  function newSvg(w, h) {
    const s = svgEl('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: '100%',
      class: 'mm-widget-svg',
      role: 'img',
      preserveAspectRatio: 'xMidYMid meet',
    });
    s.style.maxWidth = w + 'px';
    return s;
  }
  function text(x, y, str, attrs) {
    const t = svgEl('text', Object.assign({ x, y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, attrs || {}));
    t.textContent = str;
    return t;
  }
  function toIndexSet(shaded, parts) {
    // shaded = count (int) -> first N; or array of 0-based indices
    const set = new Set();
    if (Array.isArray(shaded)) {
      shaded.forEach((i) => set.add(Number(i)));
    } else {
      const n = Math.max(0, Math.min(parts, Number(shaded) || 0));
      for (let i = 0; i < n; i++) set.add(i);
    }
    return set;
  }

  const SHADE = '#ff8fb1';
  const STROKE = '#3b3b5c';
  const ACCENT = '#5b8def';

  // ---- analog-clock ---------------------------------------------------------
  function analogClock(p) {
    const W = 220, cx = 110, cy = 110, r = 96;
    const s = newSvg(W, W);
    s.appendChild(svgEl('circle', { cx, cy, r, fill: '#fffaf0', stroke: STROKE, 'stroke-width': 4 }));
    // hour numbers
    for (let n = 1; n <= 12; n++) {
      const a = (n / 12) * 2 * Math.PI - Math.PI / 2;
      const tx = cx + Math.cos(a) * (r - 20);
      const ty = cy + Math.sin(a) * (r - 20);
      s.appendChild(text(tx, ty, String(n), { 'font-size': 16, 'font-weight': 'bold', fill: STROKE }));
    }
    // minute ticks (optional)
    if (p.showMinuteTicks) {
      for (let m = 0; m < 60; m++) {
        const a = (m / 60) * 2 * Math.PI - Math.PI / 2;
        const big = m % 5 === 0;
        const r1 = r - (big ? 8 : 4);
        s.appendChild(svgEl('line', {
          x1: cx + Math.cos(a) * r1, y1: cy + Math.sin(a) * r1,
          x2: cx + Math.cos(a) * r, y2: cy + Math.sin(a) * r,
          stroke: STROKE, 'stroke-width': big ? 2 : 1,
        }));
      }
    }
    const hour = Number(p.hour) || 0;
    const minute = Number(p.minute) || 0;
    const minAngle = (minute / 60) * 2 * Math.PI - Math.PI / 2;
    const hrAngle = (((hour % 12) + minute / 60) / 12) * 2 * Math.PI - Math.PI / 2;
    // hour hand
    s.appendChild(svgEl('line', {
      x1: cx, y1: cy, x2: cx + Math.cos(hrAngle) * (r * 0.5), y2: cy + Math.sin(hrAngle) * (r * 0.5),
      stroke: STROKE, 'stroke-width': 7, 'stroke-linecap': 'round',
    }));
    // minute hand
    s.appendChild(svgEl('line', {
      x1: cx, y1: cy, x2: cx + Math.cos(minAngle) * (r * 0.8), y2: cy + Math.sin(minAngle) * (r * 0.8),
      stroke: ACCENT, 'stroke-width': 5, 'stroke-linecap': 'round',
    }));
    s.appendChild(svgEl('circle', { cx, cy, r: 6, fill: STROKE }));
    return s;
  }

  // ---- number-line ----------------------------------------------------------
  function numberLine(p) {
    const min = Number(p.min), max = Number(p.max), step = Number(p.step) || 1;
    const W = 480, H = 110, padX = 30, y = 60;
    const s = newSvg(W, H);
    const span = max - min || 1;
    const xOf = (v) => padX + ((v - min) / span) * (W - 2 * padX);
    s.appendChild(svgEl('line', { x1: padX, y1: y, x2: W - padX, y2: y, stroke: STROKE, 'stroke-width': 3 }));
    // arrowheads
    s.appendChild(svgEl('polygon', { points: `${W - padX},${y} ${W - padX - 10},${y - 6} ${W - padX - 10},${y + 6}`, fill: STROKE }));
    s.appendChild(svgEl('polygon', { points: `${padX},${y} ${padX + 10},${y - 6} ${padX + 10},${y + 6}`, fill: STROKE }));
    const labels = {};
    if (Array.isArray(p.marks)) p.marks.forEach((m) => { if (m.label != null) labels[m.value] = m.label; });
    for (let v = min; v <= max + 1e-9; v += step) {
      const x = xOf(v);
      s.appendChild(svgEl('line', { x1: x, y1: y - 8, x2: x, y2: y + 8, stroke: STROKE, 'stroke-width': 2 }));
      const lab = labels[v] != null ? labels[v] : (Number.isInteger(v) ? v : +v.toFixed(2));
      s.appendChild(text(x, y + 24, String(lab), { 'font-size': 13, fill: STROKE }));
    }
    if (p.highlight != null) {
      const x = xOf(Number(p.highlight));
      s.appendChild(svgEl('circle', { cx: x, cy: y, r: 8, fill: SHADE, stroke: STROKE, 'stroke-width': 2 }));
    }
    return s;
  }

  // ---- fraction-bar ---------------------------------------------------------
  function fractionBar(p) {
    const parts = Math.max(1, Number(p.parts) || 1);
    const W = 420, H = 90, x0 = 10, y0 = 20, w = W - 20, h = 50;
    const s = newSvg(W, H);
    const shaded = toIndexSet(p.shaded, parts);
    const pw = w / parts;
    for (let i = 0; i < parts; i++) {
      s.appendChild(svgEl('rect', {
        x: x0 + i * pw, y: y0, width: pw, height: h,
        fill: shaded.has(i) ? SHADE : '#fffaf0', stroke: STROKE, 'stroke-width': 2,
      }));
    }
    return s;
  }

  // ---- fraction-circle ------------------------------------------------------
  function fractionCircle(p) {
    const parts = Math.max(1, Number(p.parts) || 1);
    const W = 220, cx = 110, cy = 110, r = 96;
    const s = newSvg(W, W);
    const shaded = toIndexSet(p.shaded, parts);
    for (let i = 0; i < parts; i++) {
      const a0 = (i / parts) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / parts) * 2 * Math.PI - Math.PI / 2;
      const x1 = cx + Math.cos(a0) * r, y1 = cy + Math.sin(a0) * r;
      const x2 = cx + Math.cos(a1) * r, y2 = cy + Math.sin(a1) * r;
      const large = (a1 - a0) > Math.PI ? 1 : 0;
      const d = parts === 1
        ? `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
        : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
      s.appendChild(svgEl('path', {
        d, fill: shaded.has(i) ? SHADE : '#fffaf0', stroke: STROKE, 'stroke-width': 2,
      }));
    }
    return s;
  }

  // ---- array-dots -----------------------------------------------------------
  function arrayDots(p) {
    const rows = Math.max(1, Number(p.rows) || 1);
    const cols = Math.max(1, Number(p.cols) || 1);
    const gap = 34, pad = 20, rr = 12;
    const W = pad * 2 + (cols - 1) * gap;
    const H = pad * 2 + (rows - 1) * gap;
    const s = newSvg(Math.max(W, 60), Math.max(H, 60));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        s.appendChild(svgEl('circle', { cx: pad + c * gap, cy: pad + r * gap, r: rr, fill: ACCENT, stroke: STROKE, 'stroke-width': 2 }));
      }
    }
    return s;
  }

  // ---- base-ten-blocks ------------------------------------------------------
  function baseTenBlocks(p) {
    const hundreds = Math.max(0, Number(p.hundreds) || 0);
    const tens = Math.max(0, Number(p.tens) || 0);
    const ones = Math.max(0, Number(p.ones) || 0);
    const W = 480, H = 160, u = 12, s = newSvg(W, H);
    let x = 10;
    const drawFlat = (ox) => {
      for (let r = 0; r < 10; r++) for (let c = 0; c < 10; c++)
        s.appendChild(svgEl('rect', { x: ox + c * u, y: 10 + r * u, width: u - 1, height: u - 1, fill: '#9ad29a', stroke: STROKE, 'stroke-width': 0.5 }));
      return 10 * u;
    };
    const drawRod = (ox) => {
      for (let r = 0; r < 10; r++)
        s.appendChild(svgEl('rect', { x: ox, y: 10 + r * u, width: u - 1, height: u - 1, fill: '#f3c24b', stroke: STROKE, 'stroke-width': 0.5 }));
      return u;
    };
    const drawUnit = (ox, oy) => {
      s.appendChild(svgEl('rect', { x: ox, y: oy, width: u - 1, height: u - 1, fill: SHADE, stroke: STROKE, 'stroke-width': 0.5 }));
    };
    for (let i = 0; i < hundreds; i++) { x += drawFlat(x) + 8; }
    for (let i = 0; i < tens; i++) { x += drawRod(x) + 4; }
    let oy = 10;
    for (let i = 0; i < ones; i++) { drawUnit(x, oy); oy += u; if (oy > 10 + 9 * u) { oy = 10; x += u; } }
    return s;
  }

  // ---- shape ----------------------------------------------------------------
  function regularPolygonPoints(cx, cy, r, n, rotationDeg) {
    const pts = [];
    const rot = ((rotationDeg || 0) * Math.PI) / 180 - Math.PI / 2;
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * 2 * Math.PI;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  function shape(p) {
    const W = 240, cx = 120, cy = 120, r = 90, s = newSvg(W, W);
    const name = (p.name || '').toLowerCase();
    const sidesByName = { triangle: 3, square: 4, rectangle: 4, pentagon: 5, hexagon: 6 };
    let pts = null;
    if (name === 'circle') {
      s.appendChild(svgEl('circle', { cx, cy, r, fill: '#cfe3ff', stroke: STROKE, 'stroke-width': 3 }));
    } else if (name === 'rectangle') {
      const w = 170, h = 110;
      s.appendChild(svgEl('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, fill: '#cfe3ff', stroke: STROKE, 'stroke-width': 3, transform: `rotate(${p.rotation || 0} ${cx} ${cy})` }));
      pts = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    } else {
      const n = Number(p.sides) || sidesByName[name] || 4;
      pts = regularPolygonPoints(cx, cy, r, n, name === 'square' ? 45 + (p.rotation || 0) : (p.rotation || 0));
      s.appendChild(svgEl('polygon', { points: pts.map((pt) => pt.join(',')).join(' '), fill: '#cfe3ff', stroke: STROKE, 'stroke-width': 3 }));
    }
    // side labels at edge midpoints
    if (pts && Array.isArray(p.sideLabels)) {
      for (let i = 0; i < pts.length && i < p.sideLabels.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        s.appendChild(text((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, String(p.sideLabels[i]), { 'font-size': 14, fill: STROKE, 'font-weight': 'bold' }));
      }
    }
    if (pts && Array.isArray(p.angleLabels)) {
      for (let i = 0; i < pts.length && i < p.angleLabels.length; i++) {
        s.appendChild(text(pts[i][0], pts[i][1], String(p.angleLabels[i]), { 'font-size': 12, fill: ACCENT }));
      }
    }
    return s;
  }

  // ---- bar-model ------------------------------------------------------------
  function barModel(p) {
    const bars = Array.isArray(p.bars) ? p.bars : [];
    const maxUnits = Math.max(1, ...bars.map((b) => Number(b.units) || 0));
    const W = 460, unitW = (W - 130) / maxUnits, barH = 38, gap = 16, padTop = 20;
    const H = padTop + bars.length * (barH + gap) + (p.brace ? 30 : 10);
    const s = newSvg(W, H);
    const palette = ['#ff8fb1', '#5b8def', '#9ad29a', '#f3c24b', '#c08af0'];
    bars.forEach((b, i) => {
      const y = padTop + i * (barH + gap);
      const w = (Number(b.units) || 0) * unitW;
      s.appendChild(text(8, y + barH / 2, String(b.label != null ? b.label : ''), { 'text-anchor': 'start', 'font-size': 13, fill: STROKE }));
      s.appendChild(svgEl('rect', { x: 110, y, width: w, height: barH, fill: b.color || palette[i % palette.length], stroke: STROKE, 'stroke-width': 2 }));
      s.appendChild(text(110 + w / 2, y + barH / 2, String(b.units), { 'font-size': 13, fill: STROKE, 'font-weight': 'bold' }));
    });
    if (p.brace) {
      const yB = padTop + bars.length * (barH + gap) - gap + 6;
      s.appendChild(svgEl('line', { x1: 110, y1: yB, x2: W - 20, y2: yB, stroke: STROKE, 'stroke-width': 2 }));
      s.appendChild(text((110 + W - 20) / 2, yB + 14, String(p.brace.label != null ? p.brace.label : ''), { 'font-size': 13, fill: STROKE }));
    }
    return s;
  }

  // ---- coordinate-grid ------------------------------------------------------
  function coordinateGrid(p) {
    const w = Math.max(1, Number(p.width) || 10);
    const h = Math.max(1, Number(p.height) || 10);
    const pad = 30, cell = Math.min(34, 300 / Math.max(w, h));
    const W = pad * 2 + w * cell, H = pad * 2 + h * cell, s = newSvg(W, H);
    const xOf = (x) => pad + x * cell;
    const yOf = (y) => H - pad - y * cell;
    if (p.showGrid !== false) {
      for (let x = 0; x <= w; x++) s.appendChild(svgEl('line', { x1: xOf(x), y1: yOf(0), x2: xOf(x), y2: yOf(h), stroke: '#dcdcec', 'stroke-width': 1 }));
      for (let y = 0; y <= h; y++) s.appendChild(svgEl('line', { x1: xOf(0), y1: yOf(y), x2: xOf(w), y2: yOf(y), stroke: '#dcdcec', 'stroke-width': 1 }));
    }
    // axes
    s.appendChild(svgEl('line', { x1: xOf(0), y1: yOf(0), x2: xOf(w), y2: yOf(0), stroke: STROKE, 'stroke-width': 2 }));
    s.appendChild(svgEl('line', { x1: xOf(0), y1: yOf(0), x2: xOf(0), y2: yOf(h), stroke: STROKE, 'stroke-width': 2 }));
    for (let x = 0; x <= w; x++) s.appendChild(text(xOf(x), yOf(0) + 14, String(x), { 'font-size': 10, fill: STROKE }));
    for (let y = 1; y <= h; y++) s.appendChild(text(xOf(0) - 12, yOf(y), String(y), { 'font-size': 10, fill: STROKE }));
    (p.points || []).forEach((pt) => {
      s.appendChild(svgEl('circle', { cx: xOf(Number(pt.x)), cy: yOf(Number(pt.y)), r: 6, fill: SHADE, stroke: STROKE, 'stroke-width': 2 }));
      if (pt.label != null) s.appendChild(text(xOf(Number(pt.x)) + 14, yOf(Number(pt.y)) - 10, String(pt.label), { 'font-size': 11, fill: STROKE }));
    });
    return s;
  }

  // ---- bar-chart ------------------------------------------------------------
  function barChart(p) {
    const cats = Array.isArray(p.categories) ? p.categories : [];
    const yMax = Number(p.yMax) || Math.max(1, ...cats.map((c) => Number(c.value) || 0));
    const yStep = Number(p.yStep) || 1;
    const W = 460, H = 280, padL = 40, padB = 40, padT = 20, padR = 20;
    const s = newSvg(W, H);
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const yOf = (v) => padT + plotH - (v / yMax) * plotH;
    // axes + gridlines
    for (let v = 0; v <= yMax + 1e-9; v += yStep) {
      const y = yOf(v);
      s.appendChild(svgEl('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: '#dcdcec', 'stroke-width': 1 }));
      s.appendChild(text(padL - 12, y, String(v), { 'font-size': 11, fill: STROKE }));
    }
    s.appendChild(svgEl('line', { x1: padL, y1: padT, x2: padL, y2: padT + plotH, stroke: STROKE, 'stroke-width': 2 }));
    s.appendChild(svgEl('line', { x1: padL, y1: padT + plotH, x2: W - padR, y2: padT + plotH, stroke: STROKE, 'stroke-width': 2 }));
    const bw = plotW / (cats.length || 1) * 0.6;
    const palette = ['#ff8fb1', '#5b8def', '#9ad29a', '#f3c24b', '#c08af0'];
    cats.forEach((c, i) => {
      const cx = padL + (i + 0.5) * (plotW / (cats.length || 1));
      const val = Number(c.value) || 0;
      const y = yOf(val);
      s.appendChild(svgEl('rect', { x: cx - bw / 2, y, width: bw, height: padT + plotH - y, fill: palette[i % palette.length], stroke: STROKE, 'stroke-width': 2 }));
      s.appendChild(text(cx, padT + plotH + 16, String(c.label != null ? c.label : ''), { 'font-size': 12, fill: STROKE }));
    });
    return s;
  }

  const WIDGETS = {
    'analog-clock': analogClock,
    'number-line': numberLine,
    'fraction-bar': fractionBar,
    'fraction-circle': fractionCircle,
    'array-dots': arrayDots,
    'base-ten-blocks': baseTenBlocks,
    'shape': shape,
    'bar-model': barModel,
    'coordinate-grid': coordinateGrid,
    'bar-chart': barChart,
  };

  // ---- SVG escape-hatch sanitizer ------------------------------------------
  // Remove <script>, on* handlers, and external references. Returns a safe
  // SVG element parsed from the (untrusted) string, or null.
  function sanitizeSvg(svgString) {
    const doc = new DOMParser().parseFromString(String(svgString), 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() === 'parsererror') return null;
    const walk = (node) => {
      // strip script/foreignObject elements entirely
      const kids = Array.from(node.childNodes);
      for (const child of kids) {
        if (child.nodeType !== 1) continue; // only elements
        const tag = child.nodeName.toLowerCase();
        if (tag === 'script' || tag === 'foreignobject') {
          node.removeChild(child);
          continue;
        }
        // strip dangerous attributes
        for (const attr of Array.from(child.attributes)) {
          const an = attr.name.toLowerCase();
          const av = String(attr.value).toLowerCase().trim();
          if (an.startsWith('on')) child.removeAttribute(attr.name);
          else if ((an === 'href' || an === 'xlink:href' || an === 'src') &&
                   !av.startsWith('#') && !av.startsWith('data:image/')) {
            child.removeAttribute(attr.name);
          } else if (av.includes('javascript:')) {
            child.removeAttribute(attr.name);
          }
        }
        walk(child);
      }
    };
    walk(root);
    // import into the live document so it renders
    return document.importNode(root, true);
  }

  function altFallback(spec) {
    const div = document.createElement('div');
    div.className = 'mm-alt';
    div.textContent = (spec && spec.alt) || 'visual';
    return div;
  }

  /**
   * Render a question's `render` spec into an element. Always returns an element
   * (alt-text fallback if anything is missing/unsupported).
   */
  function renderRender(spec) {
    if (!spec || spec.kind === 'none' || spec.kind == null) {
      return document.createDocumentFragment();
    }
    const wrap = document.createElement('div');
    wrap.className = 'mm-visual';
    try {
      if (spec.kind === 'widget') {
        const fn = WIDGETS[spec.widget];
        if (!fn) {
          console.warn('[mathmallow] unknown widget:', spec.widget, '- showing alt text');
          wrap.appendChild(altFallback(spec));
        } else {
          const el = fn(spec.params || {});
          if (spec.alt) el.setAttribute('aria-label', spec.alt);
          wrap.appendChild(el);
        }
      } else if (spec.kind === 'image') {
        const img = document.createElement('img');
        img.src = spec.src || '';
        img.alt = spec.alt || '';
        img.className = 'mm-visual-img';
        wrap.appendChild(img);
      } else if (spec.kind === 'svg') {
        const safe = sanitizeSvg(spec.svg || '');
        if (safe) {
          safe.setAttribute('class', (safe.getAttribute('class') || '') + ' mm-widget-svg');
          if (spec.alt) safe.setAttribute('aria-label', spec.alt);
          wrap.appendChild(safe);
        } else {
          wrap.appendChild(altFallback(spec));
        }
      } else {
        wrap.appendChild(altFallback(spec));
      }
    } catch (err) {
      console.warn('[mathmallow] render error:', err);
      wrap.appendChild(altFallback(spec));
    }
    // always include an accessible alt somewhere
    if (spec.alt) {
      const sr = document.createElement('span');
      sr.className = 'mm-sr-only';
      sr.textContent = spec.alt;
      wrap.appendChild(sr);
    }
    return wrap;
  }

  window.WIDGETS = WIDGETS;
  window.renderRender = renderRender;
  window.sanitizeSvg = sanitizeSvg;
})();
