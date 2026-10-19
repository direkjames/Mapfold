// Mapfold — the wiki: entry list and article editor, [[link]] typing help, quick switcher, and the
// glue that links pins, regions and routes to entries. Author: direk james
import { db } from './db.js';
import { $, $$, esc, toast, dialog, confirmBox } from './ui.js';
import { icon, PALETTE } from './icons.js';
import { touchWorld } from './store.js';
import { cleanCalendar, formatDay, formatRange, byDate, isDay } from './calendar.js';
import { dateRowHtml, bindDateRows, calendarDialog, timelineHtml } from './timeline.js';
import {
  ENTRY_TYPES, TYPE_ORDER, newEntry, typeOf, displayName, nameOf, buildIndex, toEditText, fromEditText,
  searchEntries, allTags, parseList, renderBodyHtml, snippet, backlinksOf, unresolvedIn,
} from './entries.js';

/**
 * The editor hands us what we can't know ourselves:
 *   host.maps()                 every map record of the open world (objects included)
 *   host.currentMap()           the map on screen
 *   host.saveMap(map)           persist a map record after we changed it
 *   host.checkpoint()           push an undo step for the current map
 *   host.jumpTo(mapId, kind, id) open a map and select an object on it
 *   host.openMap(mapId)         open a map
 *   host.onEntriesChanged()     names or secrecy changed: redraw the map
 */
let host = null;
const W = {
  world: null, list: [], byId: new Map(), index: new Map(),
  selected: null, q: '', type: '', tag: '', editing: false, view: '', tlPlace: '',
  dirty: new Map(), timer: 0, open: false, root: null,
};

const KIND_TYPE = { pin: 'place', region: 'place', route: 'lore' };
const KIND_LIST = { pin: 'pins', region: 'regions', route: 'routes' };
const KIND_NAME = { pin: 'Pin', region: 'Region', route: 'Route' };

export const entryMap = () => W.byId;
export const entryList = () => W.list;
export const linkedEntry = o => (o.entryId && W.byId.get(o.entryId)) || null;
export const isWikiOpen = () => W.open;
export const calendar = () => cleanCalendar(W.world?.calendar);
export const eventsList = () => W.list.filter(e => e.type === 'event');

// ------------------------------------------------------------------ data

export async function loadWiki(world) {
  await flushEntries();
  W.world = world;
  W.list = await db.entriesOf(world.id);
  W.selected = null; W.q = ''; W.type = ''; W.tag = ''; W.editing = false; W.view = ''; W.tlPlace = '';
  reindex();
}

function reindex() {
  W.byId = new Map(W.list.map(e => [e.id, e]));
  W.index = buildIndex(W.list);
}

export function touchEntry(e) {
  e.updated = Date.now();
  W.dirty.set(e.id, e);
  clearTimeout(W.timer);
  W.timer = setTimeout(flushEntries, 700);
}

export async function flushEntries() {
  clearTimeout(W.timer);
  if (!W.dirty.size) return;
  const rows = [...W.dirty.values()];
  W.dirty.clear();
  try {
    await db.putEntries(rows);
    if (W.world) await touchWorld(W.world.id);
  } catch (err) {
    console.error(err);
    for (const e of rows) W.dirty.set(e.id, e);
    toast('Saving the wiki failed. Your browser may be out of storage space. Export the world to keep a copy.', 'bad', 6000);
  }
}

export function createEntry(type, name = '') {
  const e = newEntry(W.world.id, type, name);
  if (type === 'faction') e.color = nextFactionColor();
  W.list.push(e);
  reindex();
  touchEntry(e);
  return e;
}

const factionColors = () => new Set(W.list.filter(e => e.type === 'faction' && e.color).map(e => e.color));
function nextFactionColor() {
  const used = factionColors();
  return (PALETTE.find(c => !used.has(c.hex)) || PALETTE[W.list.filter(e => e.type === 'faction').length % PALETTE.length]).hex;
}

/** Faction entries, A to Z, for the region inspector. */
export function factionList() {
  return W.list.filter(e => e.type === 'faction').sort((a, b) => displayName(a).localeCompare(displayName(b)));
}

export function newFaction(name) {
  const e = createEntry('faction', name);
  host.onEntriesChanged();
  return e;
}

async function deleteEntry(e) {
  const on = objectsFor(e.id);
  const note = on.length ? ` ${on.length === 1 ? 'One pin or region' : on.length + ' pins, regions or routes'} linked to it will stay on the map, unlinked.` : '';
  const ok = await confirmBox('Delete this entry?', `<strong>${esc(displayName(e))}</strong> will be removed from the wiki.${note} Links to it from other entries will show as broken.`, { okLabel: 'Delete entry' });
  if (!ok) return false;
  const cur = host.currentMap();
  for (const m of host.maps()) {
    let changed = false;
    for (const list of Object.values(KIND_LIST)) for (const o of m.objects[list]) {
      if (o.entryId === e.id) { if (!o.name) o.name = e.name; o.entryId = null; changed = true; }
      if (o.factionId === e.id) { o.factionId = null; changed = true; }
    }
    if (changed) { if (m === cur) host.markDirty(); else await host.saveMap(m); }
  }
  for (const ev of W.list) if (ev.placeIds?.includes(e.id)) { ev.placeIds = ev.placeIds.filter(id => id !== e.id); touchEntry(ev); }
  W.dirty.delete(e.id);
  W.list = W.list.filter(x => x !== e);
  reindex();
  await db.deleteEntry(e.id);
  await touchWorld(W.world.id);
  host.onEntriesChanged();
  return true;
}

/** Every pin, region and route in the world that points at the entry. */
export function territoryOf(entryId) {
  const out = [];
  for (const m of host.maps()) for (const o of m.objects.regions) if (o.factionId === entryId) out.push({ map: m, kind: 'region', o });
  return out;
}

export function objectsFor(entryId) {
  const out = [];
  for (const m of host.maps()) for (const [kind, list] of Object.entries(KIND_LIST)) {
    for (const o of m.objects[list]) if (o.entryId === entryId) out.push({ map: m, kind, o });
  }
  return out;
}

/**
 * Older worlds kept lore and tags on the pin itself. Move them into entries (one source of truth)
 * the first time such a world opens. Safe to run again: it only touches objects with no entry yet.
 */
export async function migrateLore() {
  let moved = 0;
  for (const m of host.maps()) {
    let changed = false;
    for (const [kind, list] of Object.entries(KIND_LIST)) {
      for (const o of m.objects[list]) {
        const hasText = typeof o.lore === 'string' && o.lore.trim();
        const hasTags = Array.isArray(o.tags) && o.tags.length;
        if (!o.entryId && (hasText || hasTags)) {
          const e = newEntry(W.world.id, KIND_TYPE[kind], o.name || '');
          e.body = hasText ? o.lore : '';
          e.tags = hasTags ? o.tags.map(String) : [];
          W.list.push(e); W.dirty.set(e.id, e);
          o.entryId = e.id; changed = true; moved++;
        }
        if (o.entryId && ('lore' in o || 'tags' in o)) { delete o.lore; delete o.tags; changed = true; }
      }
    }
    if (changed) await host.saveMap(m);
  }
  if (moved) { reindex(); await flushEntries(); }
  return moved;
}

// ------------------------------------------------------------------ pins, regions and routes

/** Make sure an object has an entry, creating one from its name if needed. */
export function ensureEntry(o, kind) {
  let e = linkedEntry(o);
  if (e) return e;
  e = createEntry(KIND_TYPE[kind], o.name || '');
  o.entryId = e.id;
  host.markDirty();
  return e;
}

export function setName(o, kind, value) {
  o.name = value;
  const e = linkedEntry(o);
  if (e) { e.name = value; reindex(); touchEntry(e); renderList(); }
}

export function setLore(o, kind, text) {
  if (!linkedEntry(o) && !text.trim()) return false;
  const made = !linkedEntry(o);
  const e = ensureEntry(o, kind);
  e.body = fromEditText(text, W.index);
  touchEntry(e);
  if (W.open) renderList();
  return made;
}

export function setTags(o, kind, text) {
  const tags = parseList(text);
  if (!linkedEntry(o) && !tags.length) return false;
  const made = !linkedEntry(o);
  const e = ensureEntry(o, kind);
  e.tags = tags;
  touchEntry(e);
  return made;
}

function linkRowHtml(o, kind) {
  const e = linkedEntry(o);
  if (!e) {
    return `<button type="button" class="btn btn-sm" data-wiki="link">${icon('link')}Link to entry</button>
      <span class="wb-hint">Writing lore here creates one for you.</span>`;
  }
  const t = typeOf(e);
  return `<button type="button" class="wb-chip" data-wiki="open" title="Open in the wiki">${icon(t.icon)}<span><strong>${esc(displayName(e))}</strong><small>${t.name}${e.secret ? ' · secret' : ''}</small></span></button>
    <button type="button" class="ph-btn" data-wiki="unlink" title="Unlink from this ${KIND_NAME[kind].toLowerCase()}">${icon('unlink')}</button>`;
}

/** The lore block shown in the inspector for a pin, region or route. */
export function wikiFields(o, kind) {
  const e = linkedEntry(o);
  const body = e ? toEditText(e.body, W.byId, W.index) : '';
  return `
    <div class="wiki-box">
      <p class="field-label wb-title">${icon('wiki')}Wiki</p>
      <div class="wb-link" data-wiki-link>${linkRowHtml(o, kind)}</div>
      <label class="field"><span>Lore <small class="field-note">type [[ to link</small></span><textarea name="lore" rows="6" placeholder="History, secrets, who lives here, what the party heard about it…">${esc(body)}</textarea></label>
      <label class="field"><span>Tags</span><input name="tags" value="${esc((e?.tags || []).join(', '))}" placeholder="act 1, rumour, haunted"></label>
    </div>`;
}

export function refreshLinkRow(box, o, kind) {
  const row = $('[data-wiki-link]', box);
  if (row) row.innerHTML = linkRowHtml(o, kind);
}

/** Wire up link, unlink and open buttons, and the [[ helper, inside an inspector. */
export function bindWikiFields(box, o, kind, { refresh }) {
  const ta = $('textarea[name=lore]', box);
  if (ta) attachLinkComplete(ta);
  box.addEventListener('click', async ev => {
    const b = ev.target.closest('[data-wiki]');
    if (!b) return;
    const act = b.dataset.wiki;
    if (act === 'open') { const e = linkedEntry(o); if (e) openWiki(e.id); }
    else if (act === 'unlink') {
      host.checkpoint();
      const e = linkedEntry(o);
      if (e && !o.name) o.name = e.name;
      o.entryId = null;
      host.markDirty(); host.onEntriesChanged(); refresh();
    } else if (act === 'link') {
      const pick = await pickEntry({ title: `Link this ${KIND_NAME[kind].toLowerCase()} to an entry`, create: { name: o.name || '', type: KIND_TYPE[kind] } });
      if (!pick) return;
      host.checkpoint();
      const e = pick.create ? createEntry(pick.create.type, pick.create.name) : W.byId.get(pick.id);
      if (!e) return;
      if (pick.create && !e.name && o.name) { e.name = o.name; reindex(); touchEntry(e); }
      o.entryId = e.id;
      host.markDirty(); host.onEntriesChanged(); refresh();
    }
  });
}

// ------------------------------------------------------------------ [[ typing help

export function attachLinkComplete(ta, { onChange } = {}) {
  let pop = null, rows = [], sel = 0, start = -1;
  const close = () => { pop?.remove(); pop = null; };
  const insert = row => {
    const pos = ta.selectionStart;
    let name = row.create ? row.create : row.entry.name;
    if (row.create) { const e = createEntry('note', row.create); name = e.name; }
    const clash = (W.index.get(name.trim().toLowerCase()) || []).length > 1 && row.entry;
    const text = clash ? `[[${row.entry.id}|${name}]]` : `[[${name}]]`;
    const after = ta.value.slice(pos).replace(/^\]\]/, '');
    ta.value = ta.value.slice(0, start) + text + after;
    ta.selectionStart = ta.selectionEnd = start + text.length;
    close();
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    onChange?.();
  };
  const paint = () => {
    if (!pop) { pop = document.createElement('div'); pop.className = 'link-pop'; document.body.append(pop); }
    const r = ta.getBoundingClientRect();
    pop.style.left = r.left + 'px'; pop.style.top = (r.bottom + 4) + 'px'; pop.style.width = Math.min(r.width, 360) + 'px';
    pop.innerHTML = rows.map((row, i) => row.create
      ? `<button type="button" data-i="${i}" class="${i === sel ? 'on' : ''}">${icon('plus')}<span>Create <strong>${esc(row.create)}</strong></span></button>`
      : `<button type="button" data-i="${i}" class="${i === sel ? 'on' : ''}">${icon(typeOf(row.entry).icon)}<span><strong>${esc(displayName(row.entry))}</strong><small>${typeOf(row.entry).name}</small></span></button>`).join('');
    $$('button', pop).forEach(b => b.onmousedown = e => { e.preventDefault(); insert(rows[+b.dataset.i]); });
  };
  const update = () => {
    const pos = ta.selectionStart;
    const m = ta.value.slice(0, pos).match(/\[\[([^\[\]\n]*)$/);
    if (!m) return close();
    start = pos - m[0].length;
    const q = m[1].trim();
    rows = searchEntries(W.list, q).slice(0, 6).map(entry => ({ entry }));
    if (q && !W.index.has(q.toLowerCase())) rows.push({ create: q });
    if (!rows.length) return close();
    sel = Math.min(sel, rows.length - 1);
    paint();
  };
  ta.addEventListener('input', update);
  ta.addEventListener('click', update);
  ta.addEventListener('blur', () => setTimeout(close, 120));
  ta.addEventListener('keydown', e => {
    if (!pop) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; paint(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insert(rows[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  }, true);
}

// ------------------------------------------------------------------ picking an entry

/** Dialog: search the wiki and choose an entry, or create one. Resolves { id } or { create: {name, type} } or null. */
export async function pickEntry({ title, create }) {
  let chosen = null, hi = 0, shown = [];
  const body = `
    <label class="search"><svg class="i"><use href="#i-search"/></svg><input type="search" name="q" placeholder="Search the wiki" autocomplete="off"></label>
    <div class="pick-list" role="listbox"></div>`;
  const { value } = await dialog({
    title, body,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Link', value: 'ok', primary: true, validate: () => !!chosen }],
    onOpen: f => {
      const input = $('[name=q]', f), list = $('.pick-list', f);
      const paint = () => {
        const q = input.value.trim();
        shown = searchEntries(W.list, q).slice(0, 30).map(entry => ({ entry }));
        if (create && (q || create.name) && !W.index.has((q || create.name).toLowerCase())) shown.push({ create: { type: create.type, name: q || create.name } });
        hi = Math.min(hi, Math.max(0, shown.length - 1));
        list.innerHTML = shown.length ? shown.map((r, i) => r.create
          ? `<button type="button" class="pick-row ${i === hi ? 'on' : ''}" data-i="${i}">${icon('plus')}<span><strong>Create “${esc(r.create.name || 'Untitled')}”</strong><small>New ${ENTRY_TYPES[r.create.type].name.toLowerCase()}</small></span></button>`
          : `<button type="button" class="pick-row ${i === hi ? 'on' : ''}" data-i="${i}">${icon(typeOf(r.entry).icon)}<span><strong>${esc(displayName(r.entry))}</strong><small>${typeOf(r.entry).name}${r.entry.secret ? ' · secret' : ''}</small></span></button>`).join('')
          : `<p class="pl-empty">The wiki is empty. Type a name to create the first entry.</p>`;
        $$('.pick-row', list).forEach(b => b.onclick = () => { chosen = shown[+b.dataset.i]; f.requestSubmit(); });
        chosen = shown[hi] || null;
      };
      input.oninput = () => { hi = 0; paint(); };
      input.onkeydown = e => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hi = Math.max(0, Math.min(shown.length - 1, hi + (e.key === 'ArrowDown' ? 1 : -1))); paint(); $('.pick-row.on', list)?.scrollIntoView({ block: 'nearest' }); }
      };
      paint();
    },
  });
  if (value !== 'ok' || !chosen) return null;
  return chosen.create ? { create: chosen.create } : { id: chosen.entry.id };
}

// ------------------------------------------------------------------ the wiki panel

export function initWiki(h) {
  host = h;
  const root = document.createElement('section');
  root.id = 'wiki';
  root.className = 'wiki';
  root.hidden = true;
  root.setAttribute('aria-label', 'World wiki');
  root.innerHTML = `
    <aside class="wk-side">
      <div class="wk-head">
        <h2>${icon('wiki')}Wiki</h2>
        <button class="btn btn-gilt btn-sm" data-act="new">${icon('plus')}New entry</button>
        <button class="tb-icon" data-act="close" title="Back to the map (Esc)">${icon('close')}</button>
      </div>
      <label class="search"><svg class="i"><use href="#i-search"/></svg><input type="search" id="wk-search" placeholder="Search names, notes, tags" autocomplete="off"></label>
      <div class="wk-tools"><button type="button" class="btn btn-sm" data-act="timeline" id="wk-tl">${icon('clock')}Timeline</button><button type="button" class="btn btn-sm" data-act="calendar">${icon('calendar')}Calendar</button></div>
      <div class="wk-types" id="wk-types"></div>
      <div class="wk-tags" id="wk-tags"></div>
      <div class="wk-list" id="wk-list"></div>
    </aside>
    <div class="wk-main" id="wk-main"></div>`;
  $('#editor').append(root);
  W.root = root;

  $('#wk-search').oninput = e => { W.q = e.target.value; renderList(); };
  $('[data-act=new]', root).onclick = () => newEntryFlow();
  $('[data-act=close]', root).onclick = closeWiki;
  root.addEventListener('click', onWikiClick);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && W.open && !document.querySelector('.dialog, .link-pop, .qs')) { e.preventDefault(); closeWiki(); }
  });
  initPreview();
  const topBtn = $('#btn-wiki');
  if (topBtn) topBtn.onclick = () => (W.open ? closeWiki() : openWiki());
}

export function openWiki(id) {
  if (id && W.byId.has(id)) { W.selected = id; W.editing = false; }
  else if (!W.selected || !W.byId.has(W.selected)) { W.selected = null; }
  W.open = true;
  W.root.hidden = false;
  $('#btn-wiki')?.classList.add('on');
  renderAll();
}

export function closeWiki() {
  W.open = false;
  W.root.hidden = true;
  $('#btn-wiki')?.classList.remove('on');
  flushEntries();
  host.onEntriesChanged();
  $('#viewport')?.focus({ preventScroll: true });
}

function newEntryFlow(type, name = '') {
  const e = createEntry(type || W.type || 'place', name);
  W.view = ''; W.selected = e.id; W.editing = true; W.open = true;
  W.q = ''; W.tag = ''; $('#wk-search').value = '';
  if (!W.type && !type) W.type = '';
  renderAll();
  setTimeout(() => $('.wk-name', W.root)?.focus(), 30);
  return e;
}

function renderAll() { renderFilters(); renderList(); renderMain(); }

function renderFilters() {
  const counts = {};
  for (const e of W.list) counts[e.type] = (counts[e.type] || 0) + 1;
  $('#wk-types').innerHTML = `<button class="chip ${!W.type ? 'on' : ''}" data-type="">All <small>${W.list.length}</small></button>` +
    TYPE_ORDER.map(t => `<button class="chip ${W.type === t ? 'on' : ''}" data-type="${t}" title="${ENTRY_TYPES[t].hint}">${icon(ENTRY_TYPES[t].icon)}${ENTRY_TYPES[t].plural}${counts[t] ? ` <small>${counts[t]}</small>` : ''}</button>`).join('');
  const tags = allTags(W.list).slice(0, 14);
  $('#wk-tags').innerHTML = tags.map(t => `<button class="chip chip-tag ${W.tag.toLowerCase() === t.tag.toLowerCase() ? 'on' : ''}" data-tag="${esc(t.tag)}">#${esc(t.tag)}</button>`).join('');
}

function visible() { return searchEntries(W.list, W.q, { type: W.type, tag: W.tag }); }

function renderList() {
  if (!W.root) return;
  const rows = visible();
  const list = $('#wk-list');
  list.innerHTML = rows.map(e => {
    const t = typeOf(e);
    const sub = (e.type === 'event' && isDay(e.day) ? formatDay(e.day, calendar()) : '') || snippet(e.body, 70) || Object.values(e.fields || {}).filter(Boolean).join(' · ') || t.name;
    return `<button class="wk-item ${e.id === W.selected ? 'on' : ''} ${e.name ? '' : 'unnamed'}" data-id="${e.id}">
      <span class="wk-ico"${e.type === 'faction' && e.color ? ` style="color:${e.color}"` : ''}>${icon(t.icon)}</span>
      <span class="wk-txt"><strong>${esc(displayName(e))}</strong><small>${esc(sub)}</small></span>
      ${e.secret ? `<span class="wk-lock" title="Secret">${icon('lock')}</span>` : ''}
    </button>`;
  }).join('') || (W.list.length
    ? `<p class="pl-empty">Nothing matches. <button class="linkish" data-act="clear">Clear filters</button></p>`
    : `<div class="wk-empty"><p><strong>Your wiki is empty.</strong></p><p>Add the people, places and factions of your world. Link them with <kbd>[[</kbd> as you write.</p></div>`);
}

function renderMain() {
  const main = $('#wk-main');
  const e = W.byId.get(W.selected);
  $('#wk-tl')?.classList.toggle('on', W.view === 'timeline' && !e);
  if (!e && W.view === 'timeline') { renderTimeline(main); return; }
  if (!e) {
    main.innerHTML = `
      <div class="wk-welcome">
        <h2>${W.list.length ? 'Pick an entry' : 'Start your world’s wiki'}</h2>
        <p>${W.list.length ? 'Choose one from the list, or begin a new one.' : 'Every pin, region and road can have an entry. Notes you already wrote on pins have been moved here.'}</p>
        <div class="wk-starts">${TYPE_ORDER.map(t => `<button class="wk-start" data-start="${t}">${icon(ENTRY_TYPES[t].icon)}<strong>New ${ENTRY_TYPES[t].name.toLowerCase()}</strong><small>${ENTRY_TYPES[t].hint}</small></button>`).join('')}</div>
      </div>`;
    return;
  }
  const t = typeOf(e);
  const fields = t.fields.map(f => `<label class="field"><span>${f.label}</span><input data-field="${f.key}" value="${esc(e.fields?.[f.key] || '')}" placeholder="${esc(f.ph)}"></label>`).join('');
  const onMap = objectsFor(e.id);
  const back = backlinksOf(e.id, W.list, W.index);
  const unresolved = unresolvedIn(e.body, W.index);
  const terr = e.type === 'faction' ? territoryOf(e.id) : [];
  W._terr = terr;
  const cal = calendar();
  const eventRow = e.type === 'event' ? `
        <div class="wk-event">
          ${dateRowHtml('day', 'Happens on', e.day, cal)}
          ${isDay(e.day) ? dateRowHtml('endDay', 'Ends on (optional)', e.endDay, cal) : ''}
          <div class="dt-places"><span class="dt-label">Happens at</span><div class="wk-chips">
            ${(e.placeIds || []).map(id => W.byId.get(id)).filter(Boolean).map(p => `<span class="chip">${icon(typeOf(p).icon)}<a data-entry="${p.id}" href="#">${esc(displayName(p))}</a><button type="button" class="chip-x" data-unplace="${p.id}" title="Remove" aria-label="Remove ${esc(displayName(p))}">${icon('close')}</button></span>`).join('')}
            <button type="button" class="chip chip-add" data-act="addplace">${icon('plus')}Add a place</button></div></div>
        </div>` : '';
  const here = eventsList().filter(ev => (ev.placeIds || []).includes(e.id)).sort(byDate);
  const colorRow = e.type === 'faction' ? `
        <div class="field wk-colorfield"><span>Territory colour</span><div class="wk-color">
          ${PALETTE.map(c => `<button type="button" class="sw ${e.color === c.hex ? 'on' : ''}" data-color="${c.hex}" title="${c.name}" style="--c:${c.hex}"><span></span></button>`).join('')}
          <label class="sw sw-custom" title="Custom colour"><input type="color" data-color-input value="${e.color || '#9b3a32'}"><span>${icon('plus')}</span></label>
        </div></div>` : '';
  main.innerHTML = `
    <article class="wk-article">
      <header class="wk-top">
        <div class="wk-typepick" role="radiogroup" aria-label="Entry type">
          ${TYPE_ORDER.map(k => `<button type="button" class="${e.type === k ? 'on' : ''}" data-settype="${k}" title="${ENTRY_TYPES[k].name}" role="radio" aria-checked="${e.type === k}">${icon(ENTRY_TYPES[k].icon)}<span>${ENTRY_TYPES[k].name}</span></button>`).join('')}
        </div>
        <button type="button" class="btn btn-sm wk-secret ${e.secret ? 'on' : ''}" data-act="secret" title="Secret entries, and anything linked to them, stay out of player exports">${icon(e.secret ? 'lock' : 'unlock')}${e.secret ? 'Secret' : 'Public'}</button>
        <button type="button" class="ph-btn danger" data-act="delete" title="Delete entry">${icon('trash')}</button>
      </header>
      <input class="wk-name" value="${esc(e.name)}" placeholder="Untitled ${t.name.toLowerCase()}" maxlength="120" aria-label="Name">
      <div class="wk-meta">
        <label class="field"><span>Also known as</span><input data-meta="aliases" value="${esc((e.aliases || []).join(', '))}" placeholder="Other names, comma separated"></label>
        <label class="field"><span>Tags</span><input data-meta="tags" value="${esc((e.tags || []).join(', '))}" placeholder="act 1, rumour, haunted"></label>
        ${fields}
        ${colorRow}
        ${eventRow}
      </div>
      <section class="wk-body">
        <div class="wk-bar"><h3>Notes</h3><button type="button" class="btn btn-sm" data-act="toggle">${icon(W.editing ? 'check' : 'edit')}${W.editing ? 'Done' : 'Edit'}</button></div>
        ${W.editing
          ? `<textarea class="wk-text" rows="14" placeholder="Write freely. Type [[ to link another entry. Use # for headings, - for lists, **bold** and *italic*.">${esc(toEditText(e.body, W.byId, W.index))}</textarea>
             <p class="wk-help"><kbd>[[</kbd> links to an entry, and offers to create one that doesn’t exist yet.</p>`
          : (e.body.trim()
            ? `<div class="wk-read prose" title="Double-click to edit">${renderBodyHtml(e.body, W.byId, W.index)}</div>`
            : `<p class="wk-blank">Nothing written yet. <button class="linkish" data-act="toggle">Start writing</button></p>`)}
      </section>
      ${unresolved.length ? `<section class="wk-rel"><h3>Not written yet</h3><div class="wk-chips">${unresolved.map(n => `<button class="wl wl-new" data-new="${esc(n)}">${esc(n)}</button>`).join('')}</div></section>` : ''}
      ${e.type === 'faction' ? `<section class="wk-rel"><h3>Territory</h3><div class="wk-chips">${terr.length ? terr.map((x, i) => `<button class="chip" data-terr="${i}"><i class="dot" style="--c:${e.color || '#999'}"></i>${esc(nameOf(x.o, W.byId) || 'Unnamed region')} <small>${esc(x.map.name)}</small></button>`).join('') : '<span class="wk-none">No regions yet. Select a region on a map and choose this faction.</span>'}</div></section>` : ''}
      ${here.length || e.type === 'place' ? `<section class="wk-rel"><h3>Events here</h3><div class="wk-chips">${here.length ? here.map(ev => `<a class="wl" data-entry="${ev.id}" href="#">${esc(displayName(ev))}${isDay(ev.day) ? ` <small>${esc(formatDay(ev.day, cal))}</small>` : ''}</a>`).join('') : '<span class="wk-none">Nothing has happened here yet. Add this place to an Event.</span>'}</div></section>` : ''}
      <section class="wk-rel">
        <h3>On the map</h3>
        <div class="wk-chips">${onMap.length ? onMap.map((x, i) => `<button class="chip" data-show="${i}">${icon(x.kind === 'pin' ? 'pin' : x.kind)}${esc(x.map.name)}</button>`).join('') : '<span class="wk-none">Not on any map yet. Select a pin and use “Link to entry”.</span>'}</div>
      </section>
      <section class="wk-rel">
        <h3>Mentioned in</h3>
        <div class="wk-chips">${back.length ? back.map(b => `<a class="wl" data-entry="${b.id}" href="#">${esc(displayName(b))}</a>`).join('') : '<span class="wk-none">No other entry links here yet.</span>'}</div>
      </section>
    </article>`;
  W._onMap = onMap;
  bindArticle(e);
}

function bindArticle(e) {
  const main = $('#wk-main');
  const ci = $('[data-color-input]', main);
  if (ci) ci.oninput = () => { e.color = ci.value; touchEntry(e); host.onEntriesChanged(); renderList(); };
  const name = $('.wk-name', main);
  name.oninput = () => { e.name = name.value; reindex(); touchEntry(e); renderList(); renderFilters(); host.onEntriesChanged(); };
  $$('[data-field]', main).forEach(i => i.oninput = () => { (e.fields ||= {})[i.dataset.field] = i.value; touchEntry(e); renderList(); });
  $$('[data-meta]', main).forEach(i => i.oninput = () => {
    e[i.dataset.meta] = parseList(i.value);
    if (i.dataset.meta === 'aliases') reindex();
    touchEntry(e);
    if (i.dataset.meta === 'tags') renderFilters();
  });
  const evBox = $('.wk-event', main);
  if (evBox) {
    const cal = calendar();
    bindDateRows(evBox, cal, k => (k === 'endDay' ? e.day + 1 : isDay(W.world.currentDay) ? W.world.currentDay : 0), (key, day) => {
      if (key === 'day') { e.day = day; if (day === null) e.endDay = null; else if (isDay(e.endDay) && e.endDay <= day) e.endDay = null; }
      else e.endDay = day === null || day <= e.day ? null : day;
      touchEntry(e); renderMain(); renderList();
    });
  }
  const ta = $('.wk-text', main);
  if (ta) {
    attachLinkComplete(ta);
    ta.oninput = () => { e.body = fromEditText(ta.value, W.index); touchEntry(e); renderList(); };
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !document.querySelector('.link-pop')) { ev.stopPropagation(); setEditing(false); } });
    setTimeout(() => { if (!name.value || document.activeElement === document.body) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } }, 20);
  }
  const read = $('.wk-read', main);
  if (read) read.ondblclick = ev => { if (!ev.target.closest('a, button')) setEditing(true); };
}

function setEditing(on) {
  W.editing = on;
  const e = W.byId.get(W.selected);
  if (e && !on) reindex();
  renderMain();
}

function select(id) { W.view = ''; W.selected = id; W.editing = false; renderList(); renderMain(); $('#wk-list .wk-item.on')?.scrollIntoView({ block: 'nearest' }); }

async function onWikiClick(ev) {
  const t = ev.target;
  const chip = t.closest('[data-type]');
  if (chip && chip.closest('#wk-types')) { W.type = chip.dataset.type; renderFilters(); renderList(); return; }
  const tag = t.closest('[data-tag]');
  if (tag) { W.tag = W.tag.toLowerCase() === tag.dataset.tag.toLowerCase() ? '' : tag.dataset.tag; renderFilters(); renderList(); return; }
  const item = t.closest('.wk-item');
  if (item) { select(item.dataset.id); return; }
  const start = t.closest('[data-start]');
  if (start) { newEntryFlow(start.dataset.start); return; }
  const link = t.closest('a[data-entry]');
  if (link) { ev.preventDefault(); if (W.byId.has(link.dataset.entry)) select(link.dataset.entry); return; }
  const miss = t.closest('[data-new]');
  if (miss) {
    const made = createEntry('note', miss.dataset.new);
    const cur = W.byId.get(W.selected);
    if (cur && cur !== made) { cur.body = fromEditText(cur.body, W.index); touchEntry(cur); }
    W.selected = made.id; W.editing = true; renderAll();
    return;
  }
  const col = t.closest('button[data-color]');
  if (col) { const f = W.byId.get(W.selected); if (f) { f.color = col.dataset.color; touchEntry(f); renderMain(); host.onEntriesChanged(); } return; }
  const terrChip = t.closest('[data-terr]');
  if (terrChip) { const x = W._terr[+terrChip.dataset.terr]; if (x) { closeWiki(); host.jumpTo(x.map.id, x.kind, x.o.id); } return; }
  const show = t.closest('[data-show]');
  if (show) { const x = W._onMap[+show.dataset.show]; if (x) { closeWiki(); host.jumpTo(x.map.id, x.kind, x.o.id); } return; }
  const unplace = t.closest('[data-unplace]');
  if (unplace) { const ev = W.byId.get(W.selected); if (ev) { ev.placeIds = (ev.placeIds || []).filter(id => id !== unplace.dataset.unplace); touchEntry(ev); renderMain(); } return; }
  const act = t.closest('[data-act]')?.dataset.act;
  const e = W.byId.get(W.selected);
  if (act === 'timeline') { W.view = W.view === 'timeline' && !e ? '' : 'timeline'; W.selected = null; W.editing = false; renderList(); renderMain(); return; }
  if (act === 'calendar') { editCalendar(); return; }
  if (act === 'addplace' && e) { addPlace(e); return; }
  if (act === 'clear') { W.q = ''; W.type = ''; W.tag = ''; $('#wk-search').value = ''; renderAll(); }
  else if (act === 'toggle') setEditing(!W.editing);
  else if (act === 'secret' && e) { e.secret = !e.secret; touchEntry(e); renderList(); renderMain(); host.onEntriesChanged(); }
  else if (act === 'delete' && e) {
    const rows = visible(); const at = rows.indexOf(e);
    if (await deleteEntry(e)) { const next = visible()[Math.min(at, visible().length - 1)]; W.selected = next ? next.id : null; renderAll(); }
  } else {
    const st = t.closest('[data-settype]');
    if (st && e) { e.type = st.dataset.settype; touchEntry(e); renderAll(); }
  }
}

// ------------------------------------------------------------------ calendar and timeline

async function editCalendar() {
  const res = await calendarDialog(W.world);
  if (!res) return;
  W.world.calendar = res.calendar;
  W.world.currentDay = res.currentDay;
  W.world.updated = Date.now();
  try { await db.putWorld(W.world); } catch (err) { console.error(err); toast('Saving the calendar failed. Your browser may be out of storage space.', 'bad', 6000); return; }
  toast('Calendar saved.');
  renderList(); renderMain();
}

async function addPlace(ev) {
  const pick = await pickEntry({ title: 'Where did it happen?', create: { type: 'place', name: '' } });
  if (!pick) return;
  const id = pick.create ? createEntry(pick.create.type, pick.create.name).id : pick.id;
  if (id === ev.id) return;
  if (!(ev.placeIds ||= []).includes(id)) ev.placeIds.push(id);
  touchEntry(ev); renderAll();
}

function renderTimeline(main) {
  const cal = calendar();
  const events = eventsList();
  const placeIds = new Set(events.flatMap(e => e.placeIds || []));
  const places = [...placeIds].map(id => W.byId.get(id)).filter(Boolean).sort((a, b) => displayName(a).localeCompare(displayName(b)));
  if (W.tlPlace && !placeIds.has(W.tlPlace)) W.tlPlace = '';
  main.innerHTML = `
    <div class="tl">
      <header class="tl-head">
        <div><h2>${icon('clock')}Timeline</h2><p>${esc(cal.name)}${isDay(W.world.currentDay) ? ` · today is ${esc(formatDay(W.world.currentDay, cal))}` : ''}</p></div>
        ${places.length ? `<label class="tl-filter"><span>Place</span><select id="tl-place"><option value="">All places</option>${places.map(p => `<option value="${p.id}" ${p.id === W.tlPlace ? 'selected' : ''}>${esc(displayName(p))}</option>`).join('')}</select></label>` : ''}
        <button type="button" class="btn btn-gilt btn-sm" data-start="event">${icon('plus')}New event</button>
      </header>
      ${timelineHtml(events, cal, { today: W.world.currentDay, placeId: W.tlPlace, byId: W.byId })}
    </div>`;
  $('#tl-place', main)?.addEventListener('change', e => { W.tlPlace = e.target.value; renderTimeline(main); });
  $$('.tl-card', main).forEach(c => c.onclick = () => select(c.dataset.id));
}

// ------------------------------------------------------------------ hover preview

function initPreview() {
  let pop = null, timer = 0;
  const hide = () => { clearTimeout(timer); pop?.remove(); pop = null; };
  document.addEventListener('mouseover', ev => {
    const a = ev.target.closest?.('a.wl[data-entry]');
    if (!a) return;
    const e = W.byId.get(a.dataset.entry);
    if (!e) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      hide();
      pop = document.createElement('div');
      pop.className = 'wl-pop';
      const t = typeOf(e);
      pop.innerHTML = `<div class="wl-pop-head">${icon(t.icon)}<strong>${esc(displayName(e))}</strong><small>${t.name}${e.secret ? ' · secret' : ''}</small></div><p>${esc(snippet(e.body, 220)) || '<em>Nothing written yet.</em>'}</p>`;
      document.body.append(pop);
      const r = a.getBoundingClientRect();
      pop.style.left = Math.min(r.left, innerWidth - 340) + 'px';
      pop.style.top = (r.bottom + 6) + 'px';
    }, 260);
  });
  document.addEventListener('mouseout', ev => { if (ev.target.closest?.('a.wl[data-entry]')) hide(); });
  document.addEventListener('mousedown', hide);
}

// ------------------------------------------------------------------ quick switcher (Ctrl/Cmd + K)

export function openSwitcher() {
  if ($('.qs')) return;
  const wrap = document.createElement('div');
  wrap.className = 'qs';
  wrap.innerHTML = `
    <div class="qs-card" role="dialog" aria-label="Find anything">
      <label class="qs-input">${icon('search')}<input type="text" placeholder="Jump to an entry, place or map" autocomplete="off" spellcheck="false"></label>
      <div class="qs-list" role="listbox"></div>
      <div class="qs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>↵</kbd> open</span><span><kbd>⇧</kbd><kbd>↵</kbd> show on map</span><span><kbd>Esc</kbd> close</span></div>
    </div>`;
  document.body.append(wrap);
  const input = $('input', wrap), listEl = $('.qs-list', wrap);
  let rows = [], hi = 0;

  const sources = () => {
    const out = [];
    for (const e of W.list) {
      const onMap = objectsFor(e.id)[0];
      out.push({ k: 'entry', title: displayName(e), sub: typeOf(e).name + (e.secret ? ' · secret' : ''), icon: typeOf(e).icon, e, onMap, hay: [e.name, ...(e.aliases || []), ...(e.tags || [])] });
    }
    for (const m of host.maps()) {
      out.push({ k: 'map', title: m.name, sub: 'Map', icon: 'map', m, hay: [m.name] });
      for (const [kind, list] of Object.entries(KIND_LIST)) for (const o of m.objects[list]) {
        const n = nameOf(o, W.byId);
        if (!n || o.entryId) continue;
        out.push({ k: 'obj', title: n, sub: `${KIND_NAME[kind]} on ${m.name}`, icon: kind === 'pin' ? 'pin' : kind, m, kind, o, hay: [n] });
      }
    }
    return out;
  };
  const all = sources();
  const score = (r, q) => {
    if (!q) return r.k === 'entry' ? 1 : 0.5;
    let best = 0;
    r.hay.forEach((h, i) => {
      const s = String(h || '').toLowerCase();
      if (!s) return;
      const v = s === q ? 100 : s.startsWith(q) ? 80 : s.split(/\s+/).some(w => w.startsWith(q)) ? 65 : s.includes(q) ? 50 : 0;
      best = Math.max(best, i === 0 ? v : v * 0.8);
    });
    return best;
  };
  const paint = () => {
    const q = input.value.trim().toLowerCase();
    rows = all.map(r => [score(r, q), r]).filter(x => x[0] > 0).sort((a, b) => b[0] - a[0] || a[1].title.localeCompare(b[1].title)).slice(0, 40).map(x => x[1]);
    if (q && !W.index.has(q)) rows.push({ k: 'create', title: `Create “${input.value.trim()}”`, sub: 'New entry', icon: 'plus', name: input.value.trim() });
    hi = Math.min(hi, Math.max(0, rows.length - 1));
    listEl.innerHTML = rows.length ? rows.map((r, i) => `<button type="button" class="qs-row ${i === hi ? 'on' : ''}" data-i="${i}">${icon(r.icon)}<span><strong>${esc(r.title)}</strong><small>${esc(r.sub)}</small></span>${r.onMap ? `<em title="On a map">${icon('map')}</em>` : ''}</button>`).join('') : '<p class="pl-empty">Nothing yet. Make something with <kbd>New entry</kbd>.</p>';
    $$('.qs-row', listEl).forEach(b => { b.onclick = ev => go(rows[+b.dataset.i], ev.shiftKey); b.onmousemove = () => { if (hi !== +b.dataset.i) { hi = +b.dataset.i; $$('.qs-row', listEl).forEach((x, j) => x.classList.toggle('on', j === hi)); } }; });
  };
  const close = () => { document.removeEventListener('keydown', onKey, true); wrap.remove(); };
  const go = (r, showOnMap) => {
    if (!r) return;
    close();
    if (r.k === 'entry') { if (showOnMap && r.onMap) host.jumpTo(r.onMap.map.id, r.onMap.kind, r.onMap.o.id); else openWiki(r.e.id); }
    else if (r.k === 'map') host.openMap(r.m.id);
    else if (r.k === 'obj') host.jumpTo(r.m.id, r.kind, r.o.id);
    else if (r.k === 'create') { openWiki(); newEntryFlow('place', r.name); }
  };
  const onKey = ev => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(); }
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { ev.preventDefault(); hi = Math.max(0, Math.min(rows.length - 1, hi + (ev.key === 'ArrowDown' ? 1 : -1))); $$('.qs-row', listEl).forEach((x, j) => x.classList.toggle('on', j === hi)); $('.qs-row.on', listEl)?.scrollIntoView({ block: 'nearest' }); }
    else if (ev.key === 'Enter') { ev.preventDefault(); go(rows[hi], ev.shiftKey); }
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', ev => { if (ev.target === wrap) close(); });
  input.oninput = () => { hi = 0; paint(); };
  paint();
  input.focus();
}
