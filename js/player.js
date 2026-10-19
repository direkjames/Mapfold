// Mapfold — the player window. It only ever shows the picture the GM window sends; it never opens the
// database, so there is nothing secret in here to find. Author: direk james
const ch = new BroadcastChannel('mapfold-player');
const $ = s => document.querySelector(s);
const stage = $('#stage'), img = $('#map'), wait = $('#wait'), black = $('#blackout');
let url = null, dims = null, rect = null;

function layout() {
  if (!dims) return;
  const W = innerWidth, Hh = innerHeight;
  // Show the whole map, or the part of it the GM is looking at.
  const r = rect && rect.x1 - rect.x0 > 0.01 && rect.y1 - rect.y0 > 0.01 ? rect : { x0: 0, y0: 0, x1: 1, y1: 1 };
  const vw = (r.x1 - r.x0) * dims.w, vh = (r.y1 - r.y0) * dims.h;
  const k = Math.min(W / vw, Hh / vh);
  const tx = (W - vw * k) / 2 - r.x0 * dims.w * k, ty = (Hh - vh * k) / 2 - r.y0 * dims.h * k;
  img.style.width = dims.w * k + 'px';
  img.style.height = dims.h * k + 'px';
  img.style.transform = `translate(${tx}px, ${ty}px)`;
}

function show(msg) {
  const next = URL.createObjectURL(msg.blob);
  const old = url;
  const done = () => {
    url = next;
    dims = { w: msg.w, h: msg.h };
    img.hidden = false; wait.hidden = true;
    layout();
    if (old) URL.revokeObjectURL(old);
    document.title = `${msg.name || 'Map'} · Mapfold`;
  };
  const probe = new Image();
  probe.onload = () => { img.src = next; done(); };
  probe.onerror = () => URL.revokeObjectURL(next);
  probe.src = next;
}

ch.onmessage = ev => {
  const m = ev.data || {};
  if (m.t === 'frame' && m.blob instanceof Blob) show(m);
  else if (m.t === 'view') { rect = m.rect && ['x0', 'y0', 'x1', 'y1'].every(k => Number.isFinite(m.rect[k])) ? m.rect : null; layout(); }
  else if (m.t === 'blackout') black.hidden = !m.on;
  else if (m.t === 'idle') {
    img.hidden = true; wait.hidden = false; dims = null;
    $('#wait-title').textContent = 'Waiting for the map';
  }
};

addEventListener('resize', layout);
addEventListener('beforeunload', () => ch.postMessage({ t: 'bye' }));
addEventListener('keydown', e => {
  if (e.key.toLowerCase() === 'f') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {}); }
});
document.addEventListener('fullscreenchange', () => { $('#hint').hidden = !!document.fullscreenElement; });
setTimeout(() => $('#hint').classList.add('quiet'), 6000);
ch.postMessage({ t: 'hello' });
