// Mapfold — world/map model, export and import. Author: direk james
import { db, uid } from './db.js';
import { makeZip, readZip, textOf } from './zip.js';

export const FORMAT_VERSION = 1;
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
    objects: { pins: [], labels: [], regions: [], routes: [] },
  };
}

export async function createWorld(name) {
  const w = { id: uid('w'), name, created: Date.now(), updated: Date.now(), author: 'direk james', version: FORMAT_VERSION };
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
    mapsOut.push(entry);
  }
  const thumb = await db.getBlob('thumb:' + worldId);
  if (thumb) files.push({ name: 'thumb.png', data: thumb });
  const manifest = {
    format: 'mapfold', version: FORMAT_VERSION, app: 'Mapfold', author: 'direk james',
    exported: new Date().toISOString(), world, maps: mapsOut,
  };
  files.unshift({ name: 'world.json', data: JSON.stringify(manifest, null, 1) });
  return makeZip(files);
}

export async function importWorld(file) {
  const entries = await readZip(file);
  const wj = entries.get('world.json');
  if (!wj) throw new Error('This file has no world inside. Pick a .mapfold file exported from Mapfold.');
  const data = JSON.parse(textOf(wj));
  if (data.format !== 'mapfold') throw new Error('This is not a Mapfold world file.');
  if (data.version > FORMAT_VERSION) throw new Error('This world was made with a newer Mapfold. Update the app and try again.');

  const existing = await db.allWorlds();
  let name = data.world.name || 'Imported world';
  if (existing.some(w => w.name === name)) name += ' (imported)';
  const world = { ...data.world, id: uid('w'), name, updated: Date.now() };
  await db.putWorld(world);

  for (const m of data.maps) {
    const { files = {}, ...rest } = m;
    const map = { ...rest, id: uid('m'), worldId: world.id };
    map.layers = { ...defaultLayers(), ...(map.layers || {}) };
    map.objects = { pins: [], labels: [], regions: [], routes: [], ...(map.objects || {}) };
    await db.putMap(map);
    if (files.base && entries.get(files.base)) await db.putBlob('base:' + map.id, new Blob([entries.get(files.base)], { type: files.baseType || 'image/png' }));
    if (files.terrain && entries.get(files.terrain)) await db.putBlob('terrain:' + map.id, new Blob([entries.get(files.terrain)], { type: 'image/png' }));
  }
  if (entries.get('thumb.png')) await db.putBlob('thumb:' + world.id, new Blob([entries.get('thumb.png')], { type: 'image/png' }));
  return world;
}

// ---------- Inkfold interchange ----------

/**
 * Coordinates are normalised 0–1 against the map image so they survive resizing.
 * Inkfold reads pins, labels, regions and routes and ignores anything else.
 */
export function interchangeFor(map, world) {
  const nx = x => +(x / map.width).toFixed(5);
  const ny = y => +(y / map.height).toFixed(5);
  const pt = p => [nx(p[0]), ny(p[1])];
  const o = map.objects;
  return {
    format: 'mapfold-interchange',
    version: 1,
    source: { app: 'Mapfold', author: 'direk james', worldId: world.id, worldName: world.name, mapId: map.id, mapName: map.name },
    image: { file: 'map.png', width: map.width, height: map.height, rendered: 'rendered.png' },
    pins: o.pins.map(p => ({ id: p.id, x: nx(p.x), y: ny(p.y), label: p.name, icon: p.icon, color: p.color, note: p.lore || '' })),
    labels: o.labels.map(l => ({ id: l.id, x: nx(l.x), y: ny(l.y), text: l.text, style: l.style, size: +(l.size / map.height).toFixed(5), rotation: l.rotation || 0, color: l.color })),
    regions: o.regions.map(r => ({ id: r.id, name: r.name, color: r.color, points: r.points.map(pt), note: r.lore || '' })),
    routes: o.routes.map(r => ({ id: r.id, name: r.name, kind: r.kind, color: r.color, points: r.points.map(pt), note: r.lore || '' })),
  };
}
