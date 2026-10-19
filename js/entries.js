// Mapfold — wiki entries (the shared model behind places, characters, factions and events). Author: direk james
//
//   entry { id, worldId, type, name, aliases[], tags[], fields{}, body, secret, created, updated }
//
// Links between entries live in `body` as [[id|Shown name]], so renaming an entry never breaks a link.
// While you write, the editor shows them as [[Name]] and turns them back into ids as you type
// (see toEditText / fromEditText). Pure functions only: nothing here touches the page.
import { uid } from './db.js';

export const ENTRY_TYPES = {
  place:     { name: 'Place',     plural: 'Places',     icon: 'pin',    hint: 'Cities, ruins, taverns, regions',
    fields: [{ key: 'kind', label: 'Kind', ph: 'City, ruin, inn…' }, { key: 'ruler', label: 'Ruled by', ph: 'Lord, council, nobody' }, { key: 'population', label: 'Population', ph: '~4,000' }] },
  character: { name: 'Character', plural: 'Characters', icon: 'user',   hint: 'NPCs, villains, patrons',
    fields: [{ key: 'role', label: 'Role', ph: 'Innkeeper, spy…' }, { key: 'status', label: 'Status', ph: 'Alive, missing…' }, { key: 'home', label: 'Lives in', ph: 'Where to find them' }] },
  faction:   { name: 'Faction',   plural: 'Factions',   icon: 'flag',   hint: 'Guilds, realms, cults',
    fields: [{ key: 'leader', label: 'Led by', ph: 'Who holds the reins' }, { key: 'aim', label: 'Wants', ph: 'Their goal' }, { key: 'base', label: 'Based in', ph: 'Seat of power' }] },
  item:      { name: 'Item',      plural: 'Items',      icon: 'gem',    hint: 'Relics, treasure, artefacts',
    fields: [{ key: 'kind', label: 'Kind', ph: 'Sword, tome…' }, { key: 'holder', label: 'Held by', ph: 'Who has it now' }] },
  lore:      { name: 'Lore',      plural: 'Lore',       icon: 'scroll', hint: 'History, myths, rules, roads',
    fields: [{ key: 'era', label: 'Era', ph: 'When it happened' }] },
  event:     { name: 'Event',     plural: 'Events',     icon: 'clock',  hint: 'Battles, festivals, plots',
    fields: [{ key: 'when', label: 'Date note', ph: 'Dusk, or “the old age”' }, { key: 'where', label: 'Place note', ph: 'Used when no place is linked' }] },
  note:      { name: 'Note',      plural: 'Notes',      icon: 'edit',   hint: 'Anything else',
    fields: [] },
};
export const TYPE_ORDER = Object.keys(ENTRY_TYPES);

export function newEntry(worldId, type, name = '') {
  return {
    id: uid('e'), worldId,
    type: ENTRY_TYPES[type] ? type : 'note',
    name, aliases: [], tags: [], fields: {}, body: '', secret: false,
    created: Date.now(), updated: Date.now(),
  };
}

export const typeOf = e => ENTRY_TYPES[e?.type] || ENTRY_TYPES.note;
export const displayName = e => (e?.name || '').trim() || `Untitled ${typeOf(e).name.toLowerCase()}`;

// ---------- things on the map that point at an entry ----------

/** The text shown for a pin, region or route: the entry's name when it has one. */
export function nameOf(o, byId) {
  const e = o.entryId && byId?.get(o.entryId);
  return (e && e.name && e.name.trim()) || o.name || '';
}

/** Secret if flagged itself, or linked to a secret entry (or, for a region, held by a secret faction). */
export function isSecret(o, byId) {
  return !!(o.secret || (o.entryId && byId?.get(o.entryId)?.secret) || (o.factionId && byId?.get(o.factionId)?.secret));
}

/** A region takes its faction's colour when the faction has one. */
export function regionColor(r, byId) {
  const f = r.factionId && byId?.get(r.factionId);
  return (f && f.color) || r.color;
}

/** Factions drawn on a map, for the legend: one row per faction, in the order they first appear. */
export function legendFor(map, byId, { hideSecret = false } = {}) {
  const seen = new Map();
  for (const r of map.objects.regions) {
    const f = r.factionId && byId?.get(r.factionId);
    if (!f || !f.color || seen.has(f.id)) continue;
    if (hideSecret && isSecret(r, byId)) continue;
    seen.set(f.id, { id: f.id, name: displayName(f), color: f.color });
  }
  return [...seen.values()];
}

// ---------- links ----------

const LINK = /\[\[([A-Za-z0-9]+)\|([^\]\n]*)\]\]/g;
const PLAIN = /\[\[([^\[\]|\n]+?)\]\]/g;

/** Entry ids linked from a piece of text. */
export function linksIn(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(LINK)) out.add(m[1]);
  return [...out];
}

/** Rewrite [[id|name]] links through an id map (ids not in the map are left alone). */
export function remapLinks(text, idMap) {
  return String(text || '').replace(LINK, (all, id, name) => idMap.has(id) ? `[[${idMap.get(id)}|${name}]]` : all);
}

/** lower-case name or alias -> entries that use it, oldest first. */
export function buildIndex(list) {
  const idx = new Map();
  for (const e of [...list].sort((a, b) => a.created - b.created)) {
    for (const n of [e.name, ...(e.aliases || [])]) {
      const k = String(n || '').trim().toLowerCase();
      if (!k) continue;
      if (!idx.has(k)) idx.set(k, []);
      if (!idx.get(k).includes(e)) idx.get(k).push(e);
    }
  }
  return idx;
}

/** Stored text -> what the writer sees: [[id|Ash Guild]] becomes [[Ash Guild]] when that name is unambiguous. */
export function toEditText(body, byId, index) {
  return String(body || '').replace(LINK, (all, id, shown) => {
    const e = byId.get(id);
    if (!e || !shown.trim()) return `[[${shown || id}]]`;
    const hits = index.get(shown.trim().toLowerCase());
    return hits && hits.length === 1 && hits[0] === e ? `[[${shown}]]` : all;
  });
}

/** What the writer typed -> stored text: [[Ash Guild]] becomes [[id|Ash Guild]]. Unknown names stay as they are. */
export function fromEditText(text, index) {
  return String(text || '').replace(PLAIN, (all, typed) => {
    const hits = index.get(typed.trim().toLowerCase());
    return hits && hits.length ? `[[${hits[0].id}|${typed.trim()}]]` : all;
  });
}

/** Links that point nowhere yet: [[Name]] with no entry called that. */
export function unresolvedIn(body, index) {
  const out = new Set();
  for (const m of String(body || '').matchAll(PLAIN)) if (!index.has(m[1].trim().toLowerCase())) out.add(m[1].trim());
  return [...out];
}

/** Body as plain text, links shown as their names (for Inkfold and search). */
export function plainText(body) {
  return String(body || '').replace(LINK, (a, id, name) => name).replace(PLAIN, '$1')
    .replace(/^#{1,3}\s+/gm, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');
}

export function snippet(body, n = 140) {
  const t = plainText(body).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
}

/** Every entry id a body links to, counting [[Name]] links that now match an entry. */
export function resolvedLinks(body, index) {
  const out = new Set(linksIn(body));
  for (const m of String(body || '').matchAll(PLAIN)) {
    const hits = index?.get(m[1].trim().toLowerCase());
    if (hits && hits.length) out.add(hits[0].id);
  }
  return [...out];
}

/** Entries whose body links to `id`. */
export function backlinksOf(id, list, index) {
  return list.filter(e => e.id !== id && resolvedLinks(e.body, index).includes(id));
}

// ---------- search ----------

/** Ranked search: name beats alias beats tag beats body. Empty query keeps everything. */
export function searchEntries(list, query = '', { type = '', tag = '' } = {}) {
  const q = query.trim().toLowerCase();
  const rows = [];
  for (const e of list) {
    if (type && e.type !== type) continue;
    if (tag && !(e.tags || []).some(t => t.toLowerCase() === tag.toLowerCase())) continue;
    if (!q) { rows.push([0, e]); continue; }
    const name = (e.name || '').toLowerCase();
    let s = 0;
    if (name === q) s = 100;
    else if (name.startsWith(q)) s = 80;
    else if (name.split(/\s+/).some(w => w.startsWith(q))) s = 65;
    else if (name.includes(q)) s = 55;
    else if ((e.aliases || []).some(a => a.toLowerCase().includes(q))) s = 45;
    else if ((e.tags || []).some(t => t.toLowerCase().includes(q))) s = 35;
    else if (plainText(e.body).toLowerCase().includes(q)) s = 15;
    else if (Object.values(e.fields || {}).some(v => String(v).toLowerCase().includes(q))) s = 10;
    if (s) rows.push([s, e]);
  }
  rows.sort((a, b) => b[0] - a[0] || (a[1].name || '').localeCompare(b[1].name || '') || a[1].created - b[1].created);
  return rows.map(r => r[1]);
}

export function allTags(list) {
  const n = new Map();
  for (const e of list) for (const t of e.tags || []) { const k = t.toLowerCase(); n.set(k, { tag: n.get(k)?.tag || t, n: (n.get(k)?.n || 0) + 1 }); }
  return [...n.values()].sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

export const parseList = s => [...new Set(String(s || '').split(',').map(x => x.trim()).filter(Boolean))];

// ---------- reading view ----------

const escHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Body -> safe HTML. Supports # headings, - lists, **bold**, *italic* and [[links]].
 * Everything is escaped first, so nothing typed can inject markup.
 */
export function renderBodyHtml(body, byId, index) {
  const inline = raw => {
    let s = escHtml(raw);
    s = s.replace(LINK, (all, id, name) => {
      const e = byId.get(id);
      return e
        ? `<a class="wl${e.secret ? ' wl-secret' : ''}" data-entry="${id}" href="#">${name || escHtml(displayName(e))}</a>`
        : `<span class="wl wl-broken" title="This entry was deleted">${name}</span>`;
    });
    s = s.replace(PLAIN, (all, typed) => {
      const hits = index.get(typed.trim().toLowerCase());
      return hits && hits.length
        ? `<a class="wl" data-entry="${hits[0].id}" href="#">${typed}</a>`
        : `<button type="button" class="wl wl-new" data-new="${typed.trim()}" title="No entry called this yet. Click to create it.">${typed}</button>`;
    });
    return s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  };
  const out = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<ul>${list.map(li => `<li>${inline(li)}</li>`).join('')}</ul>`); list = null; } };
  for (const line of String(body || '').split('\n')) {
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    const li = line.match(/^\s*[-*]\s+(.*)$/);
    if (h) { flushPara(); flushList(); out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`); }
    else if (li) { flushPara(); (list ||= []).push(li[1]); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else { flushList(); para.push(line); }
  }
  flushPara(); flushList();
  return out.join('');
}
