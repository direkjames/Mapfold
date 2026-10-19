// Mapfold — the live link to Inkfold. Author: direk james
//
// Mapfold and Inkfold live on the same site, so they can share a small database. Only Mapfold writes it.
// For every published map it holds a package: the interchange data (pins, labels, regions, routes, linked
// Place entries, scale, a revision) and a picture of the base map and terrain without any marks. Inkfold reads
// it through its own code and draws the marks itself. Secret items are never put in a package.
import { db } from './db.js';
import { renderMap } from './render.js';
import { paintParchment } from './parchment.js';
import { interchangeFor } from './store.js';

const DB_NAME = 'mapfold-link', DB_VERSION = 1, CHANNEL = 'mapfold-link';
const MAX_SIDE = 4000; // Inkfold's own map size limit
let dbp = null, channel = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('packages')) d.createObjectStore('packages', { keyPath: 'key' }).createIndex('worldId', 'worldId');
    };
    req.onsuccess = () => { req.result.onversionchange = () => { req.result.close(); dbp = null; }; resolve(req.result); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('The Inkfold link database is busy. Close other Mapfold and Inkfold tabs and try again.'));
  });
  return dbp;
}
const wrap = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
async function tx(mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction('packages', mode);
    let out; Promise.resolve(fn(t.objectStore('packages'))).then(r => { out = r; });
    t.oncomplete = () => resolve(out); t.onerror = () => reject(t.error); t.onabort = () => reject(t.error);
  });
}
function announce(msg) {
  try { (channel ||= new BroadcastChannel(CHANNEL)).postMessage(msg); } catch { /* no BroadcastChannel: Inkfold can still read on demand */ }
}
const keyOf = (worldId, mapId) => `${worldId}:${mapId}`;

/** The base map and terrain as one picture, with no pins, labels or grid. Works for any map, not just the open one. */
export async function renderPlain(map, maxSide = MAX_SIDE) {
  const k = Math.min(1, maxSide / Math.max(map.width, map.height));
  const W = Math.max(1, Math.round(map.width * k)), H = Math.max(1, Math.round(map.height * k));
  let base;
  if (map.base?.kind === 'image') {
    const b = await db.getBlob('base:' + map.id);
    base = b ? await createImageBitmap(b) : null;
  } else {
    base = document.createElement('canvas'); base.width = W; base.height = H;
    paintParchment(base.getContext('2d'), W, H, map.base?.style, map.base?.seed);
  }
  const tb = await db.getBlob('terrain:' + map.id);
  const terrain = tb ? await createImageBitmap(tb) : null;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  renderMap(c.getContext('2d'), map, { base, terrain }, { scale: k, withGrid: false, only: ['base', 'terrain'] });
  base?.close?.(); terrain?.close?.();
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  c.width = c.height = 0;
  if (!blob) throw new Error('The picture for ' + map.name + ' could not be made.');
  return blob;
}

/** Put (or refresh) packages for these maps. Skips a map whose revision hasn't changed unless force is set. */
export async function publishMaps(world, maps, entries, { force = false } = {}) {
  const byId = new Map(entries.map(e => [e.id, e]));
  const done = [];
  for (const map of maps) {
    const key = keyOf(world.id, map.id);
    const have = await tx('readonly', s => wrap(s.get(key)));
    const data = interchangeFor(map, world, byId, { hideSecret: true });
    const sig = JSON.stringify([map.updated, data.pins.length, data.entries.map(e => e.id + e.body.length + e.name)]);
    if (!force && have && have.sig === sig) continue;
    data.source.revision = Date.now();
    const plain = have && have.plainRev === map.updated && have.plain ? have.plain : await renderPlain(map);
    await tx('readwrite', s => { s.put({ key, worldId: world.id, mapId: map.id, worldName: world.name, mapName: map.name, parentMapId: map.parentMapId || null, revision: data.source.revision, sig, plainRev: map.updated, plain, interchange: data, version: 2, publishedAt: Date.now() }); });
    done.push(map.id);
  }
  if (done.length) announce({ t: 'published', worldId: world.id, mapIds: done });
  return done;
}

/** Drop packages for maps that no longer exist in the world. */
export async function pruneWorld(worldId, liveMapIds) {
  const rows = await tx('readonly', s => wrap(s.index('worldId').getAllKeys(worldId)));
  const live = new Set(liveMapIds.map(id => keyOf(worldId, id)));
  const gone = rows.filter(k => !live.has(k));
  if (gone.length) { await tx('readwrite', s => { gone.forEach(k => s.delete(k)); }); announce({ t: 'removed', worldId }); }
}

export async function forgetWorld(worldId) {
  const rows = await tx('readonly', s => wrap(s.index('worldId').getAllKeys(worldId)));
  if (rows.length) await tx('readwrite', s => { rows.forEach(k => s.delete(k)); });
  announce({ t: 'removed', worldId });
}

export async function publishedCount(worldId) {
  return (await tx('readonly', s => wrap(s.index('worldId').getAllKeys(worldId)))).length;
}
