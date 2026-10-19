// Mapfold — shared geometry, styles, and the canvas renderer for exports. Author: direk james
import { PIN_ICONS, PIN_BODY, PIN_HEAD_Y } from './icons.js';

export const LABEL_STYLES = {
  realm:      { name: 'Realm',      family: 'Cinzel',        weight: 600, italic: false, spacing: 0.32, size: 72, color: '#3a2c1e' },
  region:     { name: 'Region',     family: 'Cinzel',        weight: 500, italic: false, spacing: 0.2,  size: 40, color: '#3a2c1e' },
  water:      { name: 'Water',      family: 'Alegreya',      weight: 500, italic: true,  spacing: 0.14, size: 34, color: '#35596a' },
  settlement: { name: 'Settlement', family: 'Alegreya Sans', weight: 700, italic: false, spacing: 0.04, size: 22, color: '#3a2c1e' },
  note:       { name: 'Note',       family: 'Alegreya',      weight: 400, italic: true,  spacing: 0.02, size: 20, color: '#4a3a28' },
};

export const ROUTE_KINDS = {
  road:  { name: 'Road',     color: '#6b4a2b', width: 7, dash: null },
  trail: { name: 'Trail',    color: '#4a3826', width: 4, dash: [2.4, 1.8] },
  river: { name: 'River',    color: '#4f7f90', width: 7, dash: null },
  sea:   { name: 'Sea lane', color: '#3e5c8a', width: 4, dash: [0.01, 2.6] },
};

export function labelFont(style, size) {
  const s = LABEL_STYLES[style] || LABEL_STYLES.region;
  return `${s.italic ? 'italic ' : ''}${s.weight} ${size}px "${s.family}"`;
}

/** Catmull-Rom → cubic Bézier SVG path. */
export function pathFor(points, { closed = false, smooth = false } = {}) {
  if (!points.length) return '';
  const f = n => Math.round(n * 10) / 10;
  if (!smooth || points.length < 3) {
    return 'M' + points.map(p => `${f(p[0])} ${f(p[1])}`).join('L') + (closed ? 'Z' : '');
  }
  const pts = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]];
  let d = `M${f(pts[1][0])} ${f(pts[1][1])}`;
  const end = closed ? pts.length - 2 : pts.length - 2;
  for (let i = 1; i < end; i++) {
    const p0 = pts[i - 1], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + (closed ? 'Z' : '');
}

export function polylineLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  return L;
}

export function centroid(points) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[(i + 1) % points.length];
    const c = x0 * y1 - x1 * y0;
    a += c; cx += (x0 + x1) * c; cy += (y0 + y1) * c;
  }
  if (Math.abs(a) < 1e-6) {
    const n = points.length || 1;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

export function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Distance in map pixels → world units text. */
export function formatDistance(px, map) {
  const sc = map.scale;
  const cell = map.grid.size || 100;
  const units = (px / cell) * (sc.perCell || 1);
  const v = units >= 100 ? Math.round(units) : units >= 10 ? units.toFixed(1) : units.toFixed(2);
  return `${v} ${sc.unit || 'mi'}`;
}

/** Hex grid line segments (pointy-top) for an area. size = hex width (flat-to-flat). */
export function hexPath(width, height, w) {
  const r = w / Math.sqrt(3);          // centre to corner
  const vstep = r * 1.5;
  let d = '';
  const f = n => Math.round(n * 10) / 10;
  for (let row = -1, y = 0; y < height + r * 2; row++, y = row * vstep) {
    const offset = (row & 1) ? w / 2 : 0;
    for (let x = -w + offset; x < width + w; x += w) {
      // three upper edges per hex give a full tiling
      const cx = x, cy = y;
      d += `M${f(cx - w / 2)} ${f(cy - r / 2)}L${f(cx)} ${f(cy - r)}L${f(cx + w / 2)} ${f(cy - r / 2)}M${f(cx - w / 2)} ${f(cy - r / 2)}L${f(cx - w / 2)} ${f(cy + r / 2)}`;
    }
  }
  return d;
}

export function squarePath(width, height, s) {
  let d = '';
  for (let x = 0; x <= width + 0.5; x += s) d += `M${x} 0V${height}`;
  for (let y = 0; y <= height + 0.5; y += s) d += `M0 ${y}H${width}`;
  return d;
}

function drawText(ctx, text, x, y, style, size, color, rotation = 0) {
  const s = LABEL_STYLES[style] || LABEL_STYLES.region;
  ctx.save();
  ctx.translate(x, y);
  if (rotation) ctx.rotate(rotation * Math.PI / 180);
  ctx.font = labelFont(style, size);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${s.spacing * size}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(240,228,198,0.75)';
  ctx.lineWidth = Math.max(2, size * 0.14);
  ctx.strokeText(text, 0, 0);
  ctx.fillStyle = color || s.color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}

/**
 * Draw a whole map onto ctx at `scale` (1 = full size).
 * sources: { base: CanvasImageSource, terrain: CanvasImageSource }
 */
export function renderMap(ctx, map, sources, { scale = 1, pinScale = 1, withGrid = true, pinNames, only, hideSecret = false } = {}) {
  const L = {};
  for (const [k, v] of Object.entries(map.layers)) L[k] = { ...v, visible: v.visible && (!only || only.includes(k)) };
  const showNames = pinNames ?? map.showPinNames !== false;
  const W = map.width, H = map.height;
  ctx.save();
  ctx.scale(scale, scale);
  if (L.base.visible && sources.base) ctx.drawImage(sources.base, 0, 0, W, H);
  if (L.terrain.visible && sources.terrain) ctx.drawImage(sources.terrain, 0, 0, W, H);

  if (withGrid && L.grid.visible && map.grid.type !== 'none') {
    ctx.save();
    ctx.strokeStyle = hexToRgba(map.grid.color || '#3a2c1e', map.grid.opacity ?? 0.25);
    ctx.lineWidth = 1.2;
    const d = map.grid.type === 'hex' ? hexPath(W, H, map.grid.size) : squarePath(W, H, map.grid.size);
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    ctx.stroke(new Path2D(d));
    ctx.restore();
  }

  const vis = list => hideSecret ? list.filter(x => !x.secret) : list;
  const o = map.objects;
  if (L.regions.visible) {
    for (const r of vis(o.regions)) {
      if (r.points.length < 3) continue;
      const p = new Path2D(pathFor(r.points, { closed: true, smooth: r.smooth }));
      ctx.save();
      ctx.fillStyle = hexToRgba(r.color, r.fill ?? 0.18);
      ctx.fill(p);
      ctx.clip(p);
      ctx.strokeStyle = hexToRgba(r.color, 0.35);
      ctx.lineWidth = 18;
      ctx.stroke(p);
      ctx.restore();
      if (r.border !== 'none') {
        ctx.save();
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3;
        if (r.border === 'dashed') ctx.setLineDash([14, 9]);
        ctx.stroke(p);
        ctx.restore();
      }
      if (r.showName && r.name) {
        const c = centroid(r.points);
        drawText(ctx, r.name, c[0], c[1], 'region', r.nameSize || 40, r.color);
      }
    }
  }

  if (L.routes.visible) {
    for (const rt of vis(o.routes)) {
      if (rt.points.length < 2) continue;
      const k = ROUTE_KINDS[rt.kind] || ROUTE_KINDS.road;
      const w = rt.width || k.width;
      const p = new Path2D(pathFor(rt.points, { smooth: rt.smooth !== false }));
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = rt.color || k.color;
      ctx.lineWidth = w;
      if (k.dash) ctx.setLineDash(k.dash.map(v => v * w));
      ctx.stroke(p);
      if (rt.kind === 'road') {
        ctx.strokeStyle = 'rgba(236,222,186,0.9)';
        ctx.lineWidth = w * 0.42;
        ctx.stroke(p);
      }
      ctx.restore();
    }
  }

  if (L.labels.visible) {
    for (const lb of vis(o.labels)) {
      drawText(ctx, lb.text, lb.x, lb.y, lb.style, lb.size, lb.color, lb.rotation);
    }
  }

  if (L.pins.visible) {
    for (const pin of vis(o.pins)) {
      ctx.save();
      ctx.translate(pin.x, pin.y);
      ctx.scale(pinScale, pinScale);
      ctx.fillStyle = 'rgba(30,20,10,0.35)';
      ctx.beginPath(); ctx.ellipse(0, 0, 6, 2.5, 0, 0, Math.PI * 2); ctx.fill();
      const body = new Path2D(PIN_BODY);
      ctx.fillStyle = pin.color;
      ctx.fill(body);
      ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 1.5; ctx.stroke(body);
      ctx.fillStyle = '#f1e6c9';
      ctx.beginPath(); ctx.arc(0, PIN_HEAD_Y, 9.5, 0, Math.PI * 2); ctx.fill();
      const g = PIN_ICONS[pin.icon] || PIN_ICONS.marker;
      ctx.translate(-7.5, PIN_HEAD_Y - 7.5);
      ctx.scale(0.625, 0.625);
      ctx.strokeStyle = '#2a1d10'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.stroke(new Path2D(g.d));
      ctx.restore();
      if (pin.name && showNames) {
        drawText(ctx, pin.name, pin.x, pin.y + 14 * pinScale, 'settlement', 18 * pinScale, '#2a1d10');
      }
    }
  }
  ctx.restore();
}
