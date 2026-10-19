// Mapfold — terrain brushes and stamps. Author: direk james
// Everything is drawn in terrain-canvas pixels (map pixels × terrainScale).

export const INK = '#3a2c1e';

export const PAINTS = {
  grass:  { name: 'Grassland', color: '#9fab6c' },
  forest: { name: 'Woodland',  color: '#6f8450' },
  swamp:  { name: 'Marsh',     color: '#7a7b52' },
  sand:   { name: 'Desert',    color: '#d9bd83' },
  rock:   { name: 'Highland',  color: '#a8977a' },
  snow:   { name: 'Snow',      color: '#f2efe6' },
  water:  { name: 'Shallows',  color: '#86a7ad' },
  deep:   { name: 'Deep sea',  color: '#577f8e' },
};

export const STAMPS = {
  mountains: { name: 'Mountains' },
  hills:     { name: 'Hills' },
  trees:     { name: 'Trees' },
  pines:     { name: 'Pines' },
  reeds:     { name: 'Reeds' },
  waves:     { name: 'Waves' },
  dunes:     { name: 'Dunes' },
  marsh:     { name: 'Marsh' },
  town:      { name: 'Town' },
  castle:    { name: 'Castle' },
  ruins:     { name: 'Ruins' },
  ink:       { name: 'Ink pen' },
};

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = c => Math.max(0, Math.min(255, Math.round(c + amt * 255)));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

/** Solid dab with a soft rim. Drawn onto a per-stroke canvas at full opacity,
 *  so overlapping dabs never build up blotches; strength is applied on commit. */
export function paintDab(ctx, x, y, r, color) {
  const n = parseInt(color.slice(1), 16);
  const rgb = `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},1)`);
  g.addColorStop(0.68, `rgba(${rgb},1)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

let grainTile = null;
/** Speckled tile used to give committed paint a hand-laid texture. */
export function grain() {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = c.height = 192;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(192, 192);
  for (let i = 0; i < img.data.length; i += 4) img.data[i + 3] = Math.random() < 0.5 ? Math.floor(Math.random() * 46) : 0;
  ctx.putImageData(img, 0, 0);
  // a few broader soft spots so large fills are not flat
  for (let k = 0; k < 14; k++) {
    const x = Math.random() * 192, y = Math.random() * 192, r = 10 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.16)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return (grainTile = c);
}

export function eraseDab(ctx, x, y, r, strength) {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(0,0,0,${strength})`);
  g.addColorStop(0.7, `rgba(0,0,0,${strength})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function line(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.stroke();
}

/** Draw one stamp whose base sits on (x, y) and is roughly s tall/wide. */
export function drawStamp(ctx, kind, x, y, s, strength, rnd) {
  ctx.save();
  ctx.globalAlpha = strength;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  const lw = Math.max(1, s * 0.045);
  ctx.lineWidth = lw;

  if (kind === 'mountains') {
    const h = s * (0.75 + rnd() * 0.45), w = s * (0.85 + rnd() * 0.3);
    const px = x + (rnd() - 0.5) * w * 0.2, py = y - h;
    const L = x - w / 2, R = x + w / 2;
    ctx.fillStyle = '#efe4c8';
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(px, py); ctx.lineTo(R, y); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a99171';
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(R, y); ctx.lineTo(px + w * 0.06, y); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(px, py); ctx.lineTo(R, y); ctx.stroke();
    // ridge
    ctx.lineWidth = lw * 0.8;
    line(ctx, [px, py, px + w * 0.04, py + h * 0.35, px - w * 0.03, py + h * 0.62]);
    // hatching on the shaded flank, kept inside the outline
    ctx.save();
    ctx.beginPath(); ctx.moveTo(L, y); ctx.lineTo(px, py); ctx.lineTo(R, y); ctx.closePath(); ctx.clip();
    ctx.lineWidth = lw * 0.6;
    for (let i = 1; i <= 4; i++) {
      const t = i / 5;
      const ax = px + (R - px) * t, ay = py + (y - py) * t;
      line(ctx, [ax + lw, ay, ax - w * 0.1, ay + h * 0.12]);
    }
    ctx.restore();
    // snowcap
    if (h > s * 1.0) {
      ctx.fillStyle = '#fbf8f0';
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px - w * 0.11, py + h * 0.2);
      ctx.lineTo(px - w * 0.03, py + h * 0.16);
      ctx.lineTo(px + w * 0.03, py + h * 0.24);
      ctx.lineTo(px + w * 0.1, py + h * 0.18);
      ctx.closePath(); ctx.fill();
    }
  } else if (kind === 'hills') {
    const w = s * (0.8 + rnd() * 0.3), h = s * (0.32 + rnd() * 0.14);
    ctx.fillStyle = '#e3d6b0';
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.bezierCurveTo(x - w * 0.3, y - h * 1.3, x + w * 0.3, y - h * 1.3, x + w / 2, y);
    ctx.fill(); ctx.stroke();
    ctx.lineWidth = lw * 0.6;
    for (let i = 0; i < 3; i++) {
      const ox = x + w * (0.08 + i * 0.1);
      line(ctx, [ox, y - h * (0.55 - i * 0.12), ox + w * 0.05, y - h * (0.25 - i * 0.06)]);
    }
  } else if (kind === 'trees') {
    const r = s * (0.24 + rnd() * 0.08);
    const cy = y - r * 1.25;
    ctx.lineWidth = lw;
    line(ctx, [x, y, x, cy + r * 0.5]);
    ctx.fillStyle = shade('#7f955a', (rnd() - 0.5) * 0.1);
    ctx.beginPath();
    const bumps = 7;
    for (let i = 0; i <= bumps; i++) {
      const a = (i / bumps) * Math.PI * 2;
      const rr = r * (0.9 + rnd() * 0.15);
      const bx = x + Math.cos(a) * rr, by = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(bx, by);
      else {
        const ma = ((i - 0.5) / bumps) * Math.PI * 2;
        ctx.quadraticCurveTo(x + Math.cos(ma) * r * 1.25, cy + Math.sin(ma) * r * 1.25, bx, by);
      }
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(40,50,25,0.28)';
    ctx.beginPath(); ctx.arc(x + r * 0.25, cy + r * 0.2, r * 0.6, -0.2, Math.PI * 0.9); ctx.fill();
  } else if (kind === 'pines') {
    const h = s * (0.7 + rnd() * 0.3), w = h * 0.42;
    ctx.fillStyle = shade('#5c7649', (rnd() - 0.5) * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, y - h);
    ctx.lineTo(x + w * 0.35, y - h * 0.6); ctx.lineTo(x + w * 0.18, y - h * 0.6);
    ctx.lineTo(x + w * 0.5, y - h * 0.2); ctx.lineTo(x - w * 0.5, y - h * 0.2);
    ctx.lineTo(x - w * 0.18, y - h * 0.6); ctx.lineTo(x - w * 0.35, y - h * 0.6);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    line(ctx, [x, y - h * 0.2, x, y]);
  } else if (kind === 'reeds') {
    ctx.strokeStyle = '#4e5a35';
    ctx.lineWidth = lw * 0.8;
    for (let i = -1; i <= 1; i++) {
      const bx = x + i * s * 0.12, tx = bx + i * s * 0.08 + (rnd() - 0.5) * s * 0.05, ty = y - s * (0.45 + rnd() * 0.15) + Math.abs(i) * s * 0.08;
      ctx.beginPath(); ctx.moveTo(bx, y); ctx.quadraticCurveTo(bx, (y + ty) / 2, tx, ty); ctx.stroke();
    }
    ctx.strokeStyle = INK;
    line(ctx, [x - s * 0.3, y, x + s * 0.3, y]);
  } else if (kind === 'waves') {
    ctx.strokeStyle = '#3f5f6b';
    ctx.lineWidth = lw * 0.9;
    const w = s * 0.55;
    for (let k = 0; k < 2; k++) {
      const ox = x + k * w * 0.45 - w * 0.25, oy = y - k * s * 0.18;
      ctx.beginPath();
      ctx.moveTo(ox - w / 2, oy);
      ctx.quadraticCurveTo(ox - w / 4, oy - s * 0.14, ox, oy);
      ctx.quadraticCurveTo(ox + w / 4, oy - s * 0.14, ox + w / 2, oy);
      ctx.stroke();
    }
  } else if (kind === 'dunes') {
    const w = s * (0.9 + rnd() * 0.3), h = s * (0.26 + rnd() * 0.1);
    ctx.fillStyle = '#ecd8a4';
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.bezierCurveTo(x - w * 0.3, y - h * 1.5, x - w * 0.05, y - h * 1.2, x + w * 0.05, y - h * 0.5);
    ctx.bezierCurveTo(x + w * 0.2, y - h * 1.2, x + w * 0.38, y - h * 0.9, x + w / 2, y);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.bezierCurveTo(x - w * 0.3, y - h * 1.5, x - w * 0.05, y - h * 1.2, x + w * 0.05, y - h * 0.5);
    ctx.bezierCurveTo(x + w * 0.2, y - h * 1.2, x + w * 0.38, y - h * 0.9, x + w / 2, y);
    ctx.stroke();
    ctx.lineWidth = lw * 0.55;
    line(ctx, [x - w * 0.1, y - h * 0.9, x - w * 0.04, y - h * 0.45, x - w * 0.12, y - h * 0.1]);
    line(ctx, [x + w * 0.22, y - h * 0.6, x + w * 0.26, y - h * 0.25]);
  } else if (kind === 'marsh') {
    ctx.fillStyle = 'rgba(134,167,173,0.75)';
    ctx.beginPath(); ctx.ellipse(x, y - s * 0.06, s * 0.36, s * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#4e5a35';
    ctx.lineWidth = lw * 0.8;
    for (let i = -1; i <= 1; i++) {
      const bx = x + i * s * 0.2 + (rnd() - 0.5) * s * 0.06, by = y - s * 0.02;
      for (let k = -1; k <= 1; k++) {
        ctx.beginPath(); ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + k * s * 0.04, by - s * 0.14, bx + k * s * 0.09, by - s * (0.24 + rnd() * 0.06)); ctx.stroke();
      }
    }
  } else if (kind === 'town') {
    const houses = [[-0.3, 0.02, 0.26], [0.04, -0.04, 0.3], [0.33, 0.03, 0.24]];
    for (const [ox, oy, k] of houses) {
      const hw = s * k, hh = s * k * 0.7, bx = x + ox * s, by = y + oy * s;
      ctx.fillStyle = '#efe4c8';
      ctx.fillRect(bx - hw / 2, by - hh, hw, hh); ctx.strokeRect(bx - hw / 2, by - hh, hw, hh);
      ctx.fillStyle = '#a9553f';
      ctx.beginPath(); ctx.moveTo(bx - hw * 0.64, by - hh); ctx.lineTo(bx, by - hh - hw * 0.55); ctx.lineTo(bx + hw * 0.64, by - hh); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillRect(bx - hw * 0.1, by - hh * 0.5, hw * 0.2, hh * 0.5);
    }
  } else if (kind === 'castle') {
    const w = s * 0.95, h = s * 0.62, kw = w * 0.42, kh = h * 1.15;
    ctx.fillStyle = '#e6dbbd';
    const tower = (cx, tw, th) => {
      ctx.fillRect(cx - tw / 2, y - th, tw, th); ctx.strokeRect(cx - tw / 2, y - th, tw, th);
      ctx.fillStyle = '#7a8a9a';
      ctx.beginPath(); ctx.moveTo(cx - tw * 0.64, y - th); ctx.lineTo(cx, y - th - tw * 1.1); ctx.lineTo(cx + tw * 0.64, y - th); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#e6dbbd';
    };
    ctx.fillRect(x - w / 2, y - h * 0.62, w, h * 0.62); ctx.strokeRect(x - w / 2, y - h * 0.62, w, h * 0.62);
    for (let i = 0; i < 6; i++) { const cx = x - w / 2 + (i + 0.5) * (w / 6); ctx.fillRect(cx - w * 0.03, y - h * 0.62 - h * 0.1, w * 0.06, h * 0.1); ctx.strokeRect(cx - w * 0.03, y - h * 0.62 - h * 0.1, w * 0.06, h * 0.1); }
    tower(x - w / 2, w * 0.2, h * 0.95);
    tower(x + w / 2, w * 0.2, h * 0.95);
    tower(x, kw * 0.7, kh);
    ctx.fillStyle = INK;
    ctx.beginPath(); ctx.moveTo(x - w * 0.07, y); ctx.lineTo(x - w * 0.07, y - h * 0.22); ctx.arc(x, y - h * 0.22, w * 0.07, Math.PI, 0); ctx.lineTo(x + w * 0.07, y); ctx.closePath(); ctx.fill();
  } else if (kind === 'ruins') {
    ctx.fillStyle = '#d9cdb0';
    const walls = [[-0.34, 0.2, 0.34], [-0.04, 0.26, 0.5], [0.3, 0.17, 0.3]];
    for (const [ox, ww, hh] of walls) {
      const bx = x + ox * s, w = s * ww, h = s * hh * (0.8 + rnd() * 0.3);
      ctx.beginPath();
      ctx.moveTo(bx - w / 2, y); ctx.lineTo(bx - w / 2, y - h * 0.8); ctx.lineTo(bx - w * 0.15, y - h); ctx.lineTo(bx, y - h * 0.62);
      ctx.lineTo(bx + w * 0.22, y - h * 0.86); ctx.lineTo(bx + w / 2, y - h * 0.5); ctx.lineTo(bx + w / 2, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.lineWidth = lw * 0.55; line(ctx, [bx - w * 0.2, y - h * 0.5, bx + w * 0.2, y - h * 0.5]); ctx.lineWidth = lw;
    }
    ctx.fillStyle = INK;
    for (let i = 0; i < 5; i++) { ctx.beginPath(); ctx.arc(x + (rnd() - 0.5) * s * 0.9, y + s * 0.03 + rnd() * s * 0.04, Math.max(1, s * 0.012), 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
}

/** Spacing between stamps along a stroke, as a fraction of size. */
export const STAMP_SPACING = { mountains: 0.62, hills: 0.7, trees: 0.42, pines: 0.36, reeds: 0.6, waves: 1.1, dunes: 0.9, marsh: 0.75, town: 1.1, castle: 1.4, ruins: 1.0 };

// ---------- coastline ----------

const nearestPaint = (() => {
  const list = Object.entries(PAINTS).map(([k, p]) => { const n = parseInt(p.color.slice(1), 16); return [k, (n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  return (r, g, b) => {
    let best = '', bd = Infinity;
    for (const [k, pr, pg, pb] of list) { const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2; if (d < bd) { bd = d; best = k; } }
    return bd < 45 * 45 * 3 ? best : '';
  };
})();

/**
 * Ink a coastline where water paint meets anything else. Works in 256-row bands so a 4096 px map never
 * needs more than one extra full-size canvas. If no water is painted, the empty (unpainted) area counts as sea.
 * Returns the number of water pixels found (0 means nothing was drawn).
 */
export function outlineCoast(ctx, W, H, { width = Math.max(1.6, Math.min(W, H) / 650), alpha = 0.9 } = {}) {
  const BAND = 256;
  const mask = document.createElement('canvas');
  mask.width = W; mask.height = H;
  const mctx = mask.getContext('2d');
  const [ir, ig, ib] = [0x3a, 0x2c, 0x1e];
  let water = 0;
  const paintSea = (useEmpty) => {
    mctx.clearRect(0, 0, W, H);
    water = 0;
    for (let y0 = 0; y0 < H; y0 += BAND) {
      const h = Math.min(BAND, H - y0);
      const src = ctx.getImageData(0, y0, W, h), out = mctx.createImageData(W, h);
      const a = src.data, o = out.data;
      for (let i = 0; i < a.length; i += 4) {
        let sea = false;
        if (a[i + 3] < 48) sea = useEmpty;
        else { const k = nearestPaint(a[i], a[i + 1], a[i + 2]); sea = k === 'water' || k === 'deep'; }
        if (sea) { o[i] = ir; o[i + 1] = ig; o[i + 2] = ib; o[i + 3] = 255; water++; }
      }
      mctx.putImageData(out, 0, y0);
    }
  };
  paintSea(false);
  if (!water) paintSea(true);
  if (!water || water >= W * H * 0.999) return 0;
  const ring = document.createElement('canvas');
  ring.width = W; ring.height = H;
  const rctx = ring.getContext('2d');
  const STEPS = 16;
  for (let i = 0; i < STEPS; i++) {
    const t = (i / STEPS) * Math.PI * 2;
    rctx.drawImage(mask, Math.round(Math.cos(t) * width), Math.round(Math.sin(t) * width));
  }
  rctx.globalCompositeOperation = 'destination-out';
  rctx.drawImage(mask, 0, 0);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(ring, 0, 0);
  ctx.restore();
  mask.width = mask.height = ring.width = ring.height = 0; // release the big buffers now
  return water;
}
