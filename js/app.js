// Mapfold — app entry. Author: direk james
import { buildSprite } from './icons.js';
import { initLibrary, renderShelf } from './library.js';
import { initEditor, openWorld } from './editor.js';
import { $ } from './ui.js';

buildSprite();

function show(screen) {
  $('#library').hidden = screen !== 'library';
  $('#editor').hidden = screen !== 'editor';
  document.body.dataset.screen = screen;
}

async function goLibrary() {
  show('library');
  history.replaceState(null, '', location.pathname);
  await renderShelf();
}

async function goWorld(id) {
  show('editor');
  const ok = await openWorld(id);
  if (!ok) return goLibrary();
  history.replaceState(null, '', '#world=' + id);
}

initLibrary(goWorld);
initEditor(goLibrary);

const m = location.hash.match(/world=([\w]+)/);
if (m) goWorld(m[1]); else goLibrary();

if (innerWidth < 900 && !sessionStorage.getItem('mf-small-ok')) {
  $('#small-screen').hidden = false;
  $('#btn-small-ok').onclick = () => {
    $('#small-screen').hidden = true;
    try { sessionStorage.setItem('mf-small-ok', '1'); } catch { /* private mode */ }
  };
}

// Ask the browser not to clear our data when space runs low, and say honestly whether it agreed.
async function storageNote() {
  let persisted = false, usage = 0;
  try {
    persisted = (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
    usage = (await navigator.storage?.estimate?.())?.usage || 0;
  } catch { /* storage API unavailable */ }
  const used = usage > 1e6 ? `${(usage / 1e6).toFixed(1)} MB used on this device. ` : '';
  $('#storage-note').textContent = used + (persisted
    ? 'Protected from automatic cleanup.'
    : 'Your browser may clear this if space runs low, so export worlds you care about.');
}
storageNote();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
