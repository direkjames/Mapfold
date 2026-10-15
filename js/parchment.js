// Mapfold — procedural parchment backgrounds for blank maps. Author: direk james

export const PARCHMENTS = {
  parchment: { name: 'Aged parchment', base: '#e4d2a8', stain: '#a9844e', grain: '#5b4526', edge: '#7a5a30' },
  vellum:    { name: 'Pale vellum',    base: '#efe5cf', stain: '#c7ae80', grain: '#6b5a3c', edge: '#9a7d4e' },
  seachart:  { name: 'Sea chart',      base: '#dcdccb', stain: '#8e9f96', grain: '#3f4c4a', edge: '#5f6f68' },
  ashen:     { name: 'Ashen hide',     base: '#cbbfa6', stain: '#7d6c55', grain: '#3a3023', edge: '#4f412f' },
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function noiseCanvas(w, h, rnd, rgb, alphaMax) {
  const c = document.createElement('canvas');
  c.width = Math.max(2, w); c.height = Math.max(2, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2];
    d[i + 3] = Math.floor(Math.pow(rnd(), 2.2) * alphaMax);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Paint a parchment of the given style into ctx at width x height. */
export function paintParchment(ctx, width, height, style = 'parchment', seed = 1) {
  const p = PARCHMENTS[style] || PARCHMENTS.parchment;
  const rnd = mulberry32(seed);
  ctx.save();
  ctx.fillStyle = p.base;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Large soft stains, then medium mottling.
  const stain = hexRgb(p.stain);
  const layers = [[64, 0.55, 150], [22, 0.35, 120], [7, 0.18, 110]];
  for (const [div, alpha, aMax] of layers) {
    const nc = noiseCanvas(Math.ceil(width / (div * 4)), Math.ceil(height / (div * 4)), rnd, stain, aMax);
    ctx.globalAlpha = alpha;
    ctx.drawImage(nc, 0, 0, width, height);
  }

  // Fibres: faint long strokes.
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = p.grain;
  ctx.lineWidth = 1;
  const fibres = Math.floor((width * height) / 9000);
  for (let i = 0; i < fibres; i++) {
    const x = rnd() * width, y = rnd() * height, len = 6 + rnd() * 26, a = rnd() * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + rnd() * 4, y + Math.sin(a) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  // Fine grain tile.
  const grain = noiseCanvas(256, 256, rnd, hexRgb(p.grain), 60);
  ctx.globalAlpha = 0.22;
  const pat = ctx.createPattern(grain, 'repeat');
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, width, height);

  // Burnt, darkened edges.
  ctx.globalAlpha = 1;
  const edge = hexRgb(p.edge);
  const g = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.35, width / 2, height / 2, Math.hypot(width, height) * 0.58);
  g.addColorStop(0, `rgba(${edge},0)`);
  g.addColorStop(0.75, `rgba(${edge},0.18)`);
  g.addColorStop(1, `rgba(${edge},0.55)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, width, height);

  const band = Math.min(width, height) * 0.035;
  const sides = [
    [0, 0, 0, band, 0, 0, width, band],
    [0, height, 0, height - band, 0, height - band, width, band],
    [0, 0, band, 0, 0, 0, band, height],
    [width, 0, width - band, 0, width - band, 0, band, height],
  ];
  for (const [x0, y0, x1, y1, rx, ry, rw, rh] of sides) {
    const lg = ctx.createLinearGradient(x0, y0, x1, y1);
    lg.addColorStop(0, `rgba(${edge},0.45)`);
    lg.addColorStop(1, `rgba(${edge},0)`);
    ctx.fillStyle = lg;
    ctx.fillRect(rx, ry, rw, rh);
  }
  ctx.restore();
}
