// Mapfold — world/map model, export and import. Author: direk james
import { db, uid } from './db.js';
import { makeZip, readZip, textOf } from './zip.js';
import { cleanCalendar, isDay } from './calendar.js';
import { PACES } from './table.js';
import { remapLinks, stripSecrets, nameOf, isSecret, plainText, regionColor } from './entries.js';

export const FORMAT_VERSION = 2; // 2: wiki entries, secret flag. Version 1 files still import.
export const MAX_TERRAIN_SIDE = 4096;

export const BLANK_SIZES = {
  small:  { name: 'Skirmish',  w: 1600, h: 1200, hint: 'A town, a dungeon, a valley' },
  medium: { name: 'Province',  w: 2400, h: 1800, hint: 'A kingdom or a coastline' },
  large:  { name: 'Continent', w: 3200, h: 2400, hint: 'A whole continent' },
  wide:   { name: 'Panorama',  w: 3600, h: 2000, hint: 'Wide, for long journeys' },
};

export function defaultLayers() {
  const l = v => ({ visible: true, locked: false, ...v });
  return { base: l({ locked: true }), terrain: l(), grid: l(), regions: l(), routes: l(), labels: l(), pins: l() };
}

export function newMapRecord(worldId, { name, width, height, base, order = 0 }) {
  const longest = Math.max(width, height);
  return {
    id: uid('m'),
    worldId, name, order,
    created: Date.now(), updated: Date.now(),
    width, height,
    base,
    terrainScale: longest > MAX_TERRAIN_SIDE ? MAX_TERRAIN_SIDE / longest : 1,
    grid: { type: 'none', size: Math.round(Math.min(width, height) / 18), color: '#3a2c1e', opacity: 0.22 },
    scale: { perCell: 10, unit: 'mi' },
    layers: defaultLayers(),
    showPinNames: true,
    parentMapId: null,
    objects: { pins: [], labels: [], regions: [], routes: [] },
  };
}

// Every field that holds the id of another record. Importing a copy of a world remaps these,
// so add a line here whenever a new kind of reference is introduced.
const MAP_REFS = ['parentMapId'];
const OBJECT_REFS = {
  pins: { childMapId: 'map', entryId: 'entry' },
  regions: { entryId: 'entry', factionId: 'entry' },
  routes: { entryId: 'entry' },
  labels: {},
};

function remapMapRefs(map, ids) {
  for (const f of MAP_REFS) if (map[f]) map[f] = ids.maps.get(map[f]) || null;
  for (const [list, refs] of Object.entries(OBJECT_REFS)) {
    for (const o of map.objects[list]) {
      for (const [f, kind] of Object.entries(refs)) {
        if (!o[f]) continue;
        o[f] = (kind === 'map' ? ids.maps : ids.entries).get(o[f]) || null;
      }
      if (typeof o.lore === 'string') o.lore = remapLinks(o.lore, ids.entries);
    }
  }
}

const num = (v, lo, hi, fallback) => Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : fallback;
const arr = v => Array.isArray(v) ? v : [];

/** Make a map record read from a file safe to use: right shapes, sane sizes. */
function sanitizeMap(m) {
  const map = { ...m };
  map.name = String(map.name || 'Untitled map').slice(0, 120);
  map.width = Math.round(num(map.width, 200, 16000, 2400));
  map.height = Math.round(num(map.height, 200, 16000, 1800));
  map.layers = { ...defaultLayers(), ...(map.layers || {}) };
  // A file written by hand or by another tool may leave these out; the editor needs all of them.
  const g = map.grid && typeof map.grid === 'object' ? map.grid : {};
  map.grid = { type: ['none', 'square', 'hex'].includes(g.type) ? g.type : 'none', size: num(g.size, 8, 2000, 100), color: typeof g.color === 'string' && /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : '#3a2c1e', opacity: num(g.opacity, 0, 1, 0.22) };
  const sc = map.scale && typeof map.scale === 'object' ? map.scale : {};
  map.scale = { perCell: num(sc.perCell, 0.0001, 1e9, 10), unit: typeof sc.unit === 'string' ? sc.unit.slice(0, 12) : 'mi' };
  if (!map.base || typeof map.base !== 'object' || !['image', 'blank'].includes(map.base.kind)) map.base = { kind: 'blank', style: 'parchment', seed: 1 };
  map.fog = { on: !!(map.fog && map.fog.on) };
  const o = map.objects && typeof map.objects === 'object' ? map.objects : {};
  map.objects = { pins: arr(o.pins), labels: arr(o.labels), regions: arr(o.regions), routes: arr(o.routes) };
  map.objects.regions = map.objects.regions.filter(r => Array.isArray(r.points));
  map.objects.routes = map.objects.routes.filter(r => Array.isArray(r.points));
  for (const list of Object.values(map.objects)) for (const x of list) x.secret = !!x.secret;
  return map;
}

export async function createWorld(name) {
  const w = { id: uid('w'), name, created: Date.now(), updated: Date.now(), author: 'direk james', version: FORMAT_VERSION, lastBackup: 0 };
  await db.putWorld(w);
  return w;
}

export async function touchWorld(worldId) {
  const w = await db.getWorld(worldId);
  if (w) { w.updated = Date.now(); await db.putWorld(w); }
}

export async function imageSize(blob) {
  const bmp = await createImageBitmap(blob);
  const s = { w: bmp.width, h: bmp.height };
  bmp.close?.();
  return s;
}

// ---------- .mapfold export / import ----------

export async function exportWorld(worldId) {
  const world = await db.getWorld(worldId);
  const maps = (await db.mapsOf(worldId)).sort((a, b) => a.order - b.order);
  const files = [];
  const mapsOut = [];
  for (const m of maps) {
    const entry = { ...m, files: {} };
    const base = await db.getBlob('base:' + m.id);
    if (base) { entry.files.base = `images/${m.id}-base`; entry.files.baseType = base.type || 'image/png'; files.push({ name: entry.files.base, data: base }); }
    const terr = await db.getBlob('terrain:' + m.id);
    if (terr) { entry.files.terrain = `images/${m.id}-terrain.png`; files.push({ name: entry.files.terrain, data: terr }); }
    const fog = m.fog?.on ? await db.getBlob('fog:' + m.id) : null;
    if (fog) { entry.files.fog = `images/${m.id}-fog.png`; files.push({ name: entry.files.fog, data: fog }); }
    mapsOut.push(entry);
  }
  const thumb = await db.getBlob('thumb:' + worldId);
  if (thumb) files.push({ name: 'thumb.png', data: thumb });
  const entries = await db.entriesOf(worldId);
  const manifest = {
    format: 'mapfold', version: FORMAT_VERSION, app: 'Mapfold', author: 'direk james',
    exported: new Date().toISOString(), world, maps: mapsOut, entries,
  };
  files.unshift({ name: 'world.json', data: JSON.stringify(manifest, null, 1) });
  const zip = await makeZip(files);
  // Remember when this world was last backed up (without counting it as an edit).
  const fresh = await db.getWorld(worldId);
  if (fresh) { fresh.lastBackup = Date.now(); await db.putWorld(fresh); }
  return zip;
}

/**
 * Restoring a backup into a browser that doesn't have the world keeps every id, so links and
 * Inkfold's references still match. Importing a second copy of a world that is already here gives
 * the copy fresh ids and remaps everything that points at them.
 */
export async function importWorld(file) {
  const entries = await readZip(file);
  const wj = entries.get('world.json');
  if (!wj) throw new Error('This file has no world inside. Pick a .mapfold file exported from Mapfold.');
  let data;
  try { data = JSON.parse(textOf(wj)); } catch { throw new Error('This world file is damaged and could not be read.'); }
  if (!data || data.format !== 'mapfold' || !data.world || !Array.isArray(data.maps)) throw new Error('This is not a Mapfold world file.');
  if (data.version > FORMAT_VERSION) throw new Error('This world was made with a newer Mapfold. Update the app and try again.');

  const existing = await db.allWorlds();
  const isCopy = existing.some(w => w.id === data.world.id) || !data.world.id;
  let name = String(data.world.name || 'Imported world').slice(0, 120);
  if (existing.some(w => w.name === name)) name += ' (imported)';

  const ids = { maps: new Map(), entries: new Map() };
  const worldId = isCopy ? uid('w') : data.world.id;
  // Keep an id when restoring and nothing else uses it; otherwise issue a new one.
  const claim = async (table, oldId, prefix, inUse) => {
    const keep = !isCopy && typeof oldId === 'string' && oldId && !table.has(oldId) && !(await inUse(oldId));
    const id = keep ? oldId : uid(prefix);
    if (oldId) table.set(oldId, id);
    return id;
  };
  const mapRows = [], entryRows = [];
  for (const raw of data.maps) {
    if (!raw || typeof raw !== 'object') continue;
    const { files = {}, ...rest } = raw;
    const m = sanitizeMap(rest);
    m.id = await claim(ids.maps, raw.id, 'm', id => db.getMap(id));
    m.worldId = worldId;
    mapRows.push({ map: m, files: files && typeof files === 'object' ? files : {} });
  }
  for (const raw of arr(data.entries)) {
    if (!raw || typeof raw !== 'object') continue;
    const e = { ...raw };
    e.id = await claim(ids.entries, raw.id, 'e', id => db.getEntry(id));
    e.worldId = worldId;
    e.name = String(e.name || '').slice(0, 200);
    e.body = String(e.body || '');
    e.aliases = arr(e.aliases).map(String);
    e.tags = arr(e.tags).map(String);
    e.fields = e.fields && typeof e.fields === 'object' ? e.fields : {};
    e.secret = !!e.secret;
    if (e.type === 'event') {
      e.day = isDay(e.day) ? e.day : null;
      e.endDay = isDay(e.endDay) && e.day !== null && e.endDay > e.day ? e.endDay : null;
      e.placeIds = [...new Set(arr(e.placeIds).filter(id => typeof id === 'string'))];
    }
    entryRows.push(e);
  }
  for (const { map } of mapRows) remapMapRefs(map, ids);
  for (const e of entryRows) {
    e.body = remapLinks(e.body, ids.entries);
    if (e.placeIds) e.placeIds = e.placeIds.map(id => ids.entries.get(id)).filter(id => id && id !== e.id);
  }

  const world = { ...data.world, id: worldId, name, updated: Date.now(), version: FORMAT_VERSION, lastBackup: Date.now() };
  if (data.world.calendar) world.calendar = cleanCalendar(data.world.calendar);
  if (!isDay(world.currentDay)) delete world.currentDay;
  const pt = data.world.party;
  const pmap = pt && typeof pt === 'object' ? ids.maps.get(pt.mapId) : null;
  if (pmap && Number.isFinite(+pt.x) && Number.isFinite(+pt.y)) {
    world.party = { mapId: pmap, x: +pt.x, y: +pt.y, name: String(pt.name || 'The party').slice(0, 60), pace: PACES[pt.pace] ? pt.pace : 'normal', speed: +pt.speed > 0 ? +pt.speed : 24, visible: pt.visible !== false };
  } else delete world.party;
  await db.putWorld(world);
  for (const { map, files } of mapRows) {
    await db.putMap(map);
    if (files.base && entries.get(files.base)) await db.putBlob('base:' + map.id, new Blob([entries.get(files.base)], { type: files.baseType || 'image/png' }));
    if (files.terrain && entries.get(files.terrain)) await db.putBlob('terrain:' + map.id, new Blob([entries.get(files.terrain)], { type: 'image/png' }));
    if (map.fog.on && files.fog && entries.get(files.fog)) await db.putBlob('fog:' + map.id, new Blob([entries.get(files.fog)], { type: 'image/png' }));
  }
  if (entryRows.length) await db.putEntries(entryRows);
  if (entries.get('thumb.png')) await db.putBlob('thumb:' + world.id, new Blob([entries.get('thumb.png')], { type: 'image/png' }));
  return world;
}

// ---------- Inkfold interchange ----------

/**
 * Coordinates are normalised 0–1 against the map image so they survive resizing.
 * Inkfold reads pins, labels, regions and routes and ignores anything else.
 */
export function interchangeFor(map, world, byId = new Map()) {
  const nx = x => +(x / map.width).toFixed(5);
  const ny = y => +(y / map.height).toFixed(5);
  const pt = p => [nx(p[0]), ny(p[1])];
  const o = map.objects;
  const entryOf = x => (x.entryId && byId.get(x.entryId)) || null;
  const note = x => { const e = entryOf(x); return e ? (e.secret ? '' : plainText(stripSecrets(e.body))) : (x.lore || ''); };
  const base = x => ({ note: note(x), entryId: x.entryId || null, secret: isSecret(x, byId) });
  // Secret entries never travel: their text is left out of both `note` and `entries`.
  const linked = new Set([...o.pins, ...o.regions, ...o.routes].flatMap(x => [x.entryId, x.factionId]).filter(Boolean));
  const entries = [...linked].map(id => byId.get(id)).filter(e => e && !e.secret).map(e => ({
    id: e.id, type: e.type, name: e.name, color: e.color || null, aliases: e.aliases || [], tags: e.tags || [], fields: e.fields || {}, body: plainText(stripSecrets(e.body)),
  }));
  return {
    format: 'mapfold-interchange',
    version: 1,
    source: { app: 'Mapfold', author: 'direk james', worldId: world.id, worldName: world.name, mapId: map.id, mapName: map.name, parentMapId: map.parentMapId || null, updated: map.updated },
    image: { file: 'map.png', width: map.width, height: map.height, rendered: 'rendered.png' },
    pins: o.pins.map(p => ({ id: p.id, x: nx(p.x), y: ny(p.y), label: nameOf(p, byId), icon: p.icon, color: p.color, opensMap: p.childMapId || null, ...base(p) })),
    labels: o.labels.map(l => ({ id: l.id, x: nx(l.x), y: ny(l.y), text: l.text, style: l.style, size: +(l.size / map.height).toFixed(5), rotation: l.rotation || 0, color: l.color, secret: !!l.secret })),
    regions: o.regions.map(r => ({ id: r.id, name: nameOf(r, byId), color: regionColor(r, byId), factionId: r.factionId || null, points: r.points.map(pt), ...base(r) })),
    routes: o.routes.map(r => ({ id: r.id, name: nameOf(r, byId), kind: r.kind, color: r.color, points: r.points.map(pt), ...base(r) })),
    entries,
  };
}
