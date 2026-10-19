// Mapfold — table tools: fog of war masks, party travel maths and the party token. Author: direk james
// Canvas and maths only. The panels and the player window live in tabletop.js.

// ---------- fog of war ----------
// One mask per map, stored at no more than 1024 px on its long side. Opaque = fogged, clear = revealed.

export const FOG_MAX = 1024;
const FOG_RGB = '22,17,12';

export function fogSize(map) {
  const s = Math.min(1, FOG_MAX / Math.max(map.width, map.height));
  return { w: Math.max(1, Math.round(map.width * s)), h: Math.max(1, Math.round(map.height * s)), s };
}

export function newFog(map, covered = true) {
  const { w, h } = fogSize(map);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  if (covered) { const x = c.getContext('2d'); x.fillStyle = `rgb(${FOG_RGB})`; x.fillRect(0, 0, w, h); }
  return c;
}

/** Read a saved mask. A damaged or missing image gives a fully covered map, never an open one. */
export async function loadFog(map, blob) {
  const c = newFog(map, true);
  if (!blob) return c;
  try {
    const bmp = await createImageBitmap(blob);
    const x = c.getContext('2d');
    x.clearRect(0, 0, c.width, c.height);
    x.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close?.();
  } catch { /* keep it covered */ }
  return c;
}

/** One soft round dab. reveal clears fog, otherwise fog comes back. */
export function fogDab(ctx, x, y, r, reveal, softness = 0.35) {
  ctx.save();
  const inner = Math.max(0, 1 - softness);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  if (reveal) {
    ctx.globalCompositeOperation = 'destination-out';
    g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(inner, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  } else {
    g.addColorStop(0, `rgba(${FOG_RGB},1)`); g.addColorStop(inner, `rgba(${FOG_RGB},1)`); g.addColorStop(1, `rgba(${FOG_RGB},0)`);
  }
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

/** Reveal or cover a whole outline at once (points in map pixels, s = fog scale). */
export function fogPolygon(ctx, points, s, reveal) {
  if (points.length < 3) return;
  ctx.save();
  ctx.globalCompositeOperation = reveal ? 'destination-out' : 'source-over';
  ctx.fillStyle = ctx.strokeStyle = reveal ? '#000' : `rgb(${FOG_RGB})`;
  ctx.lineWidth = 2; ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([px, py], i) => (i ? ctx.lineTo(px * s, py * s) : ctx.moveTo(px * s, py * s)));
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

export function fogFill(ctx, w, h, covered) {
  ctx.save();
  if (covered) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = `rgb(${FOG_RGB})`; ctx.fillRect(0, 0, w, h); }
  else ctx.clearRect(0, 0, w, h);
  ctx.restore();
}

/** Lay the fog over a finished map picture. */
export function drawFog(ctx, fog, W, H) {
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(fog, 0, 0, W, H);
  ctx.restore();
}

// ---------- travel ----------

export const PACES = {
  slow:   { name: 'Slow',   mult: 2 / 3, note: 'Careful, can scout' },
  normal: { name: 'Normal', mult: 1,     note: 'A steady march' },
  fast:   { name: 'Fast',   mult: 4 / 3, note: 'Hard going, no time to look around' },
};
export const DEFAULT_SPEED = { mi: 24, km: 38, leagues: 8, ft: 24 * 5280, m: 38000, days: 1 };

export const pxToUnits = (px, map) => (px / map.grid.size) * map.scale.perCell;

/** Where a point lands on a polyline: distance along it, the nearest spot, and how far off it is. */
export function projectOnPath(points, p) {
  let best = { along: 0, point: points[0], off: Infinity }, run = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1], [bx, by] = points[i];
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (len * len)));
    const q = [ax + dx * t, ay + dy * t];
    const off = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (off < best.off) best = { along: run + len * t, point: q, off };
    run += len;
  }
  return best;
}

/** The route both points sit on (within `reach` map pixels), with the distance along it between them. */
export function routeBetween(routes, a, b, reach) {
  let best = null;
  for (const r of routes) {
    if (!r.points || r.points.length < 2) continue;
    const pa = projectOnPath(r.points, a), pb = projectOnPath(r.points, b);
    if (pa.off > reach || pb.off > reach) continue;
    const cost = pa.off + pb.off;
    if (!best || cost < best.cost) best = { route: r, from: pa.point, to: pb.point, px: Math.abs(pb.along - pa.along), cost };
  }
  return best;
}

/** Days for a distance (in map units) at a speed (units per day) and pace. Whole days, at least one for any real trip. */
export function travelDays(units, speed, paceKey) {
  const per = Math.max(0.01, speed) * (PACES[paceKey] || PACES.normal).mult;
  const d = units / per;
  return units > 0 ? Math.max(1, Math.ceil(d - 1e-9)) : 0;
}

/** The token as it is drawn on exported pictures. */
export function drawParty(ctx, party, k = 1) {
  const { x, y } = party, r = 15 * k;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 6 * k; ctx.shadowOffsetY = 2 * k;
  ctx.fillStyle = '#c8a15a';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 3 * k; ctx.strokeStyle = '#2a1d10'; ctx.stroke();
  ctx.fillStyle = '#2a1d10';
  ctx.beginPath(); ctx.moveTo(x - 4 * k, y + 8 * k); ctx.lineTo(x - 4 * k, y - 8 * k); ctx.lineTo(x + 8 * k, y - 3.5 * k); ctx.lineTo(x - 4 * k, y + 1 * k); ctx.closePath(); ctx.fill();
  ctx.restore();
}
