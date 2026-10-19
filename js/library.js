// Mapfold — the world shelf and new-map dialog. Author: direk james
import { db } from './db.js';
import { $, $$, esc, toast, dialog, confirmBox, promptBox, download, safeName, timeAgo } from './ui.js';
import { icon } from './icons.js';
import { BLANK_SIZES, createWorld, exportWorld, importWorld, newMapRecord, imageSize } from './store.js';
import { PARCHMENTS, paintParchment } from './parchment.js';

const BACKUP_AFTER = 3 * 24 * 3600 * 1000; // nudge once a world has been edited for 3 days without a backup

/** True when the world has changes that exist only in this browser, and it's been a while. */
export function needsBackup(w) {
  const last = w.lastBackup || 0;
  return w.updated > last && Date.now() - Math.max(last, w.created || 0) > BACKUP_AFTER;
}

let openEditor = null;
const fe = (f, n) => f.elements.namedItem(n);
const thumbUrls = [];

export function initLibrary(onOpen) {
  openEditor = onOpen;
  $('#btn-new-world').onclick = newWorldFlow;
  $('#btn-import-world').onclick = () => $('#file-import-world').click();
  $('#file-import-world').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const w = await importWorld(f);
      toast(`Imported ${w.name}`, 'good');
      renderShelf();
    } catch (err) {
      console.error(err);
      toast(err.message || 'That file could not be imported.', 'bad', 4500);
    }
  };
  buildCompassTicks();
  document.addEventListener('click', e => {
    if (!e.target.closest('.tome-menu, .tome-more')) $$('.tome-menu').forEach(m => m.hidden = true);
  });
}

function buildCompassTicks() {
  const g = $('.compass-ticks');
  let s = '';
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2, long = i % 8 === 0, r1 = long ? 76 : 80;
    s += `<line x1="${100 + Math.cos(a) * r1}" y1="${100 + Math.sin(a) * r1}" x2="${100 + Math.cos(a) * 84}" y2="${100 + Math.sin(a) * 84}"/>`;
  }
  g.innerHTML = s;
}

export async function renderShelf() {
  thumbUrls.splice(0).forEach(u => URL.revokeObjectURL(u));
  const worlds = (await db.allWorlds()).sort((a, b) => b.updated - a.updated);
  const wrap = $('#tomes');
  const stale = worlds.filter(needsBackup);
  const note = $('#backup-note');
  note.hidden = !stale.length;
  if (stale.length) {
    note.innerHTML = `${icon('export')}<span><strong>${stale.length === 1 ? esc(stale[0].name) : stale.length + ' worlds'}</strong> ${stale.length === 1 ? 'has' : 'have'} changes that only exist in this browser. Use <em>Export .mapfold</em> to keep a safe copy.</span>`;
  }
  $('#shelf-empty').hidden = worlds.length > 0;
  $('#shelf-count').textContent = worlds.length ? `${worlds.length} ${worlds.length === 1 ? 'world' : 'worlds'}` : '';
  const cards = await Promise.all(worlds.map(async w => {
    const maps = await db.mapsOf(w.id);
    const thumb = await db.getBlob('thumb:' + w.id);
    let img = `<div class="plate-empty">${icon('map')}</div>`;
    if (thumb) { const u = URL.createObjectURL(thumb); thumbUrls.push(u); img = `<img src="${u}" alt="">`; }
    return `
      <article class="tome" data-id="${w.id}" tabindex="0">
        <div class="tome-spine"></div>
        <div class="tome-cover">
          <div class="tome-plate">${img}</div>
          <h3 class="tome-name">${esc(w.name)}</h3>
          <p class="tome-meta">${maps.length} ${maps.length === 1 ? 'map' : 'maps'}, edited ${timeAgo(w.updated)}</p>
          ${needsBackup(w) ? `<p class="tome-warn" title="Export a .mapfold file to back this world up">Not backed up</p>` : ''}
        </div>
        <button class="tome-more" aria-label="World options">${icon('more')}</button>
        <div class="tome-menu menu" hidden>
          <button data-act="rename">${icon('edit')}<strong>Rename</strong></button>
          <button data-act="export">${icon('export')}<strong>Export .mapfold</strong></button>
          <button data-act="delete" class="danger">${icon('trash')}<strong>Delete world</strong></button>
        </div>
      </article>`;
  }));
  wrap.innerHTML = cards.join('');
  $$('.tome', wrap).forEach(el => {
    const id = el.dataset.id;
    el.addEventListener('click', e => {
      if (e.target.closest('.tome-more, .tome-menu')) return;
      openEditor(id);
    });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) openEditor(id); });
    $('.tome-more', el).onclick = e => {
      e.stopPropagation();
      const m = $('.tome-menu', el);
      $$('.tome-menu').forEach(x => { if (x !== m) x.hidden = true; });
      m.hidden = !m.hidden;
    };
    $$('.tome-menu button', el).forEach(b => b.onclick = async e => {
      e.stopPropagation();
      $('.tome-menu', el).hidden = true;
      const w = await db.getWorld(id);
      if (b.dataset.act === 'rename') {
        const n = await promptBox('Rename world', 'World name', w.name, 'Rename');
        if (n) { w.name = n; w.updated = Date.now(); await db.putWorld(w); renderShelf(); }
      } else if (b.dataset.act === 'export') {
        const blob = await exportWorld(id);
        download(blob, safeName(w.name) + '.mapfold');
        toast('World exported', 'good');
        renderShelf();
      } else if (b.dataset.act === 'delete') {
        const ok = await confirmBox('Delete this world?', `<strong>${esc(w.name)}</strong> and all of its maps will be removed from this browser. Export it first if you want a backup.`, { okLabel: 'Delete world' });
        if (ok) { await db.deleteWorld(id); toast('World deleted'); renderShelf(); }
      }
    });
  });
}

async function newWorldFlow() {
  const res = await newMapDialog({ title: 'New world', askWorldName: true });
  if (!res) return;
  const world = await createWorld(res.worldName);
  await saveNewMap(world.id, res, 0);
  openEditor(world.id);
}

/** Creates the map record (and base image blob) from dialog results. */
export async function saveNewMap(worldId, res, order) {
  let map;
  if (res.source === 'image') {
    const { w, h } = await imageSize(res.file);
    map = newMapRecord(worldId, { name: res.name, width: w, height: h, base: { kind: 'image' }, order });
    await db.putBlob('base:' + map.id, res.file);
  } else {
    const s = BLANK_SIZES[res.size];
    map = newMapRecord(worldId, { name: res.name, width: s.w, height: s.h, base: { kind: 'blank', style: res.style, seed: Math.floor(Math.random() * 1e9) }, order });
  }
  await db.putMap(map);
  return map;
}

export async function newMapDialog({ title, askWorldName = false, defaultName = 'The Known World' }) {
  const sizes = Object.entries(BLANK_SIZES).map(([k, s], i) => `
    <label class="choice">
      <input type="radio" name="size" value="${k}" ${i === 1 ? 'checked' : ''}>
      <span class="choice-card">
        <span class="size-shape" style="aspect-ratio:${s.w}/${s.h}"></span>
        <strong>${s.name}</strong>
        <small>${s.hint}</small>
      </span>
    </label>`).join('');
  const styles = Object.entries(PARCHMENTS).map(([k, p], i) => `
    <label class="choice">
      <input type="radio" name="style" value="${k}" ${i === 0 ? 'checked' : ''}>
      <span class="choice-card swatch-card"><canvas data-style="${k}" width="132" height="78"></canvas><strong>${p.name}</strong></span>
    </label>`).join('');

  const body = `
    ${askWorldName ? `<label class="field"><span>World name</span><input name="world" value="" placeholder="Aldermoor" maxlength="80" required></label>` : ''}
    <label class="field"><span>Map name</span><input name="mname" value="${askWorldName ? 'World map' : ''}" placeholder="The Sunken Coast" maxlength="80" required></label>
    <div class="seg" role="radiogroup" aria-label="Start from">
      <label><input type="radio" name="source" value="blank" checked><span>${icon('terrain')}Paint on blank parchment</span></label>
      <label><input type="radio" name="source" value="image"><span>${icon('image')}Use my own map image</span></label>
    </div>
    <div class="src-blank">
      <p class="field-label">Size</p>
      <div class="choices choices-4">${sizes}</div>
      <p class="field-label">Parchment</p>
      <div class="choices choices-4">${styles}</div>
    </div>
    <div class="src-image" hidden>
      <label class="dropzone">
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp">
        ${icon('image')}
        <strong>Choose a map image</strong>
        <span class="dz-name">PNG, JPG or WebP. Made in Inkarnate, Wonderdraft, or drawn by hand.</span>
      </label>
    </div>`;

  const { value, form } = await dialog({
    title, body, wide: true,
    buttons: [
      { label: 'Cancel', value: null },
      {
        label: askWorldName ? 'Create world' : 'Add map', value: 'ok', primary: true,
        validate: f => {
          if (fe(f,'source').value === 'image' && !fe(f,'file').files[0]) { toast('Choose a map image first.', 'bad'); return false; }
          return true;
        },
      },
    ],
    onOpen: f => {
      $$('canvas[data-style]', f).forEach(c => paintParchment(c.getContext('2d'), c.width, c.height, c.dataset.style, 7));
      const sync = () => {
        const img = fe(f,'source').value === 'image';
        $('.src-blank', f).hidden = img;
        $('.src-image', f).hidden = !img;
      };
      $$('input[name=source]', f).forEach(r => r.onchange = sync);
      fe(f,'file').onchange = () => {
        const file = fe(f,'file').files[0];
        $('.dz-name', f).textContent = file ? file.name : '';
        $('.dropzone', f).classList.toggle('has-file', !!file);
        if (file && !fe(f,'mname').value) fe(f,'mname').value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      };
    },
  });
  if (value !== 'ok') return null;
  return {
    worldName: askWorldName ? (fe(form,'world').value.trim() || defaultName) : null,
    name: fe(form,'mname').value.trim() || 'Untitled map',
    source: fe(form,'source').value,
    size: fe(form,'size').value,
    style: fe(form,'style').value,
    file: fe(form,'file').files[0],
  };
}
