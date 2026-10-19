// Mapfold — the map editor. Author: direk james
import { db, uid } from './db.js';
import { $, $$, esc, toast, dialog, confirmBox, promptBox, download, safeName } from './ui.js';
import { icon, pinGlyph, PIN_ICONS, PIN_BODY, PIN_HEAD_Y, PALETTE } from './icons.js';
import { paintParchment } from './parchment.js';
import { initTabletop, attachFog, fogBlob, fogCanvas, toolChanged, pointerDown as tableDown, pointerMove as tableMove, pointerUp as tableUp, applyFogHistory, fogPanel, fogBrushPx, partyPanel, regionFogHtml, bindRegionFog, renderParty, changed as tableChanged, viewChanged, sessionEnded } from './tabletop.js';
import { PAINTS, STAMPS, STAMP_SPACING, paintDab, eraseDab, drawStamp, grain, outlineCoast, INK } from './terrain.js';
import {
  LABEL_STYLES, ROUTE_KINDS, labelFont, pathFor, polylineLength, centroid, hexToRgba,
  formatDistance, hexPath, squarePath, renderMap,
} from './render.js';
import { exportWorld, interchangeFor, touchWorld, defaultLayers } from './store.js';
import { makeZip } from './zip.js';
import { nameOf, isSecret, plainText, regionColor, legendFor, displayName } from './entries.js';
import { trail, outline, nestable } from './nest.js';
import {
  initWiki, loadWiki, migrateLore, openWiki, closeWiki, isWikiOpen, openSwitcher, flushEntries, entryMap, linkedEntry,
  wikiFields, bindWikiFields, refreshLinkRow, setName, setLore, setTags, factionList, newFaction,
} from './wiki.js';
import { newMapDialog, saveNewMap } from './library.js';

const NS = 'http://www.w3.org/2000/svg';

const TOOLS = [
  { id: 'select', name: 'Select and move', key: 'V', icon: 'select' },
  { id: 'pan', name: 'Pan', key: 'H', icon: 'pan' },
  null,
  { id: 'pin', name: 'Place a pin', key: 'P', icon: 'pin' },
  { id: 'label', name: 'Add a label', key: 'T', icon: 'label' },
  { id: 'region', name: 'Draw a region', key: 'R', icon: 'region' },
  { id: 'route', name: 'Draw a route', key: 'L', icon: 'route' },
  null,
  { id: 'brush', name: 'Terrain brush', key: 'B', icon: 'brush' },
  { id: 'eraser', name: 'Terrain eraser', key: 'E', icon: 'eraser' },
  null,
  { id: 'measure', name: 'Measure distance', key: 'M', icon: 'measure' },
  null,
  { id: 'fog', name: 'Fog of war', key: 'F', icon: 'cloud' },
  { id: 'party', name: 'Party and travel', key: 'K', icon: 'flag' },
];

const LAYER_NAMES = {
  pins: 'Pins', labels: 'Labels', routes: 'Routes', regions: 'Regions', grid: 'Grid', terrain: 'Terrain paint', base: 'Base map',
};
const LAYER_ORDER = ['pins', 'labels', 'routes', 'regions', 'grid', 'terrain', 'base'];
const TYPE_LAYER = { pin: 'pins', label: 'labels', region: 'regions', route: 'routes' };
const TYPE_LIST = { pin: 'pins', label: 'labels', region: 'regions', route: 'routes' };
const TYPE_NAME = { pin: 'Pin', label: 'Label', region: 'Region', route: 'Route' };

const E = {
  world: null, maps: [], map: null,
  zoom: 1, panX: 0, panY: 0,
  tool: 'select',
  sel: null,
  draft: null,
  measure: null,
  brush: { mode: 'paint', paint: 'grass', stamp: 'mountains', size: 70, strength: 0.7, spacing: 1 },
  undo: [], redo: [],
  baseSource: null, tctx: null, ts: 1,
  dirtyMap: false, dirtyTerrain: false, dirtyFog: false,
  saveTimer: 0, lastThumb: 0, saving: null,
  spaceDown: false,
  drag: null,
  pendingSnap: null,
  baseUrl: null,
  onExit: null,
};

let vp, worldEl, overlay, baseCanvas, baseImage, terrainCanvas;
const G = {};

// ------------------------------------------------------------------ init

export function initEditor(onExit) {
  E.onExit = onExit;
  vp = $('#viewport');
  worldEl = $('#world');
  overlay = $('#overlay');
  baseCanvas = $('#base-canvas');
  baseImage = $('#base-image');
  terrainCanvas = $('#terrain-canvas');
  strokeCanvas = document.createElement('canvas');
  strokeCanvas.id = 'stroke-canvas';
  strokeCanvas.hidden = true;
  terrainCanvas.after(strokeCanvas);
  for (const k of ['grid', 'regions', 'routes', 'labels', 'pins', 'draft', 'handles']) G[k] = $('#g-' + k);

  initTabletop({
    map: () => E.map, world: () => E.world, maps: () => E.maps, zoom: () => E.zoom, tool: () => E.tool,
    sources: () => ({ base: E.baseSource, terrain: terrainCanvas }),
    viewRect, history: pushPaint, markFogDirty, markDirty, refreshInspector: renderInspector,
  });
  buildToolrail();
  bindViewport();
  bindKeys();
  initWiki({
    maps: () => E.maps,
    currentMap: () => E.map,
    saveMap: m => db.putMap(m),
    markDirty,
    checkpoint,
    jumpTo,
    openMap: id => { if (isWikiOpen()) closeWiki(); return loadMap(id); },
    onEntriesChanged,
  });

  $('#btn-back').onclick = exitEditor;
  $('#btn-undo').onclick = undo;
  $('#btn-redo').onclick = redo;
  $('#btn-zoom-in').onclick = () => zoomBy(1.25);
  $('#btn-zoom-out').onclick = () => zoomBy(0.8);
  $('#zoom-read').onclick = fit;
  $('#btn-help').onclick = showHelp;
  $('#btn-add-map').onclick = addMap;
  $('#places-search').oninput = renderPlaces;

  const menu = $('#menu-export');
  $('#btn-export').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) menu.hidden = true; });
  $$('button[data-export]', menu).forEach(b => b.onclick = () => { menu.hidden = true; doExport(b.dataset.export); });

  window.addEventListener('resize', () => { if (E.map) { clampPan(); applyView(); } });
  window.addEventListener('beforeunload', e => {
    flushEntries();
    if (E.dirtyMap || E.dirtyTerrain || E.dirtyFog) { flush(); e.preventDefault(); e.returnValue = ''; }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { flush(); flushEntries(); } });
}

export async function openWorld(worldId) {
  E.world = await db.getWorld(worldId);
  if (!E.world) { toast('That world could not be found.', 'bad'); return false; }
  E.maps = (await db.mapsOf(worldId)).sort((a, b) => a.order - b.order);
  $('#crumb-world').textContent = E.world.name;
  await loadWiki(E.world);
  const moved = await migrateLore();
  if (moved) toast(`Moved the lore from ${moved} ${moved === 1 ? 'pin' : 'pins, regions and routes'} into your wiki.`, 'good', 5000);
  if (!E.maps.length) {
    const res = await newMapDialog({ title: 'Add the first map' });
    if (!res) return false;
    E.maps.push(await saveNewMap(worldId, res, 0));
  }
  await loadMap(E.maps[0].id);
  return true;
}

async function exitEditor() {
  await flush();
  await flushEntries();
  E.map = null;
  sessionEnded();
  E.onExit?.();
}

// ------------------------------------------------------------------ wiki glue

/** An entry was renamed or made secret: redraw the names and styles on the map. */
function onEntriesChanged() {
  if (!E.map) return;
  renderRegions(); renderPins(); renderHandles(); renderPlaces(); renderLegend(); tableChanged();
}

/** Key to the factions shown on this map (the same one the exported image draws). */
function renderLegend() {
  const box = $('#legend');
  const rows = E.map && E.map.showLegend ? legendFor(E.map, entryMap()) : [];
  box.hidden = !rows.length;
  box.innerHTML = rows.length ? `<p>Realms</p>` + rows.map(r => `<div><i style="--c:${r.color}"></i>${esc(r.name)}</div>`).join('') : '';
}

/** Open a map and select a pin, region or route on it. */
async function jumpTo(mapId, kind, id) {
  if (isWikiOpen()) closeWiki();
  if (!E.map || E.map.id !== mapId) await loadMap(mapId);
  select({ type: kind, id });
  const o = getSel();
  if (!o) return;
  const c = o.points ? (kind === 'region' ? centroid(o.points) : o.points[Math.floor(o.points.length / 2)]) : [o.x, o.y];
  centerOn(c[0], c[1]);
}

// ------------------------------------------------------------------ maps inside maps

function mapsById() { return new Map(E.maps.map(m => [m.id, m])); }

/** World › Realm › Varn: every map from the top down to this one, each a way back up. */
function renderCrumbs() {
  const box = $('#crumb-trail');
  if (!E.map) { box.innerHTML = ''; return; }
  const chain = trail(E.map, mapsById());
  box.innerHTML = chain.map((m, i) => {
    const last = i === chain.length - 1;
    return `${i ? '<svg class="crumb-sep" viewBox="0 0 12 12"><path d="M4 2l4 4-4 4"/></svg>' : ''}${last
      ? `<span class="crumb-map" aria-current="page">${esc(m.name)}</span>`
      : `<button class="crumb-up" data-map="${m.id}" title="Back up to ${esc(m.name)}">${esc(m.name)}</button>`}`;
  }).join('');
  $$('.crumb-up', box).forEach(b => b.onclick = () => loadMap(b.dataset.map));
}

function nestFields(o) {
  const child = o.childMapId && E.maps.find(m => m.id === o.childMapId);
  const options = nestable(E.map, E.maps).filter(m => m.id !== o.childMapId);
  return `
    <div class="nest-box">
      <p class="field-label wb-title">${icon('map')}Map inside</p>
      ${child
        ? `<div class="wb-link"><button type="button" class="wb-chip" data-nest="open" title="Open this map (or double-click the pin)">${icon('map')}<span><strong>${esc(child.name)}</strong><small>Open the map inside</small></span></button>
           <button type="button" class="ph-btn" data-nest="unlink" title="Stop opening this map">${icon('unlink')}</button></div>`
        : `<div class="wb-link"><button type="button" class="btn btn-sm" data-nest="new">${icon('plus')}New map here</button>
           ${options.length ? `<button type="button" class="btn btn-sm" data-nest="choose">${icon('link')}Use an existing map</button>` : ''}</div>
           <span class="wb-hint">Double-click the pin to step inside.</span>`}
    </div>`;
}

async function linkChild(pin, child) {
  checkpoint();
  pin.childMapId = child.id;
  child.parentMapId = E.map.id;
  child.updated = Date.now();
  await db.putMap(child);
  markDirty();
  renderPins(); renderMapList(); renderCrumbs();
}

async function bindNest(box, o) {
  box.addEventListener('click', async ev => {
    const act = ev.target.closest('[data-nest]')?.dataset.nest;
    if (!act) return;
    if (act === 'open') { if (o.childMapId) loadMap(o.childMapId); }
    else if (act === 'unlink') {
      checkpoint();
      const child = E.maps.find(m => m.id === o.childMapId);
      if (child && child.parentMapId === E.map.id) { child.parentMapId = null; await db.putMap(child); }
      o.childMapId = null;
      markDirty(); renderPins(); renderMapList(); renderCrumbs(); renderInspector();
    } else if (act === 'new') {
      const res = await newMapDialog({ title: `A map inside ${nameOf(o, entryMap()) || 'this pin'}`, defaultName: nameOf(o, entryMap()) });
      if (!res) return;
      await flush();
      const m = await saveNewMap(E.world.id, res, E.maps.length);
      m.parentMapId = E.map.id;
      await db.putMap(m);
      E.maps.push(m);
      const pin = o;
      pin.childMapId = m.id;
      markDirty();
      await loadMap(m.id);
      toast(`${m.name} opens from its pin. Use the trail at the top to climb back.`, 'good', 4200);
    } else if (act === 'choose') {
      const options = nestable(E.map, E.maps).filter(m => m.id !== o.childMapId);
      const { value, form } = await dialog({
        title: 'Which map is inside?',
        body: `<div class="pick-list">${outline(options).map(({ map: m, depth }) => `<label class="pick-row" style="padding-left:${10 + depth * 16}px"><input type="radio" name="m" value="${m.id}"><span><strong>${esc(m.name)}</strong></span></label>`).join('')}</div>`,
        buttons: [{ label: 'Cancel', value: null }, { label: 'Use this map', value: 'ok', primary: true, validate: f => !!f.querySelector('[name=m]:checked') }],
      });
      if (value !== 'ok') return;
      const child = E.maps.find(m => m.id === form.querySelector('[name=m]:checked').value);
      if (child) { await linkChild(o, child); renderInspector(); }
    }
  });
}

// ------------------------------------------------------------------ load map

async function loadMap(id) {
  if (E.map) await flush();
  const map = E.maps.find(m => m.id === id) || await db.getMap(id);
  map.layers = { ...defaultLayers(), ...(map.layers || {}) };
  map.objects = { pins: [], labels: [], regions: [], routes: [], ...(map.objects || {}) };
  E.map = map;
  E.sel = null; E.draft = null; E.measure = null; E.undo = []; E.redo = [];
  E.ts = map.terrainScale || 1;
  renderCrumbs();

  worldEl.style.width = map.width + 'px';
  worldEl.style.height = map.height + 'px';
  overlay.setAttribute('viewBox', `0 0 ${map.width} ${map.height}`);
  overlay.setAttribute('width', map.width);
  overlay.setAttribute('height', map.height);

  if (E.baseUrl) { URL.revokeObjectURL(E.baseUrl); E.baseUrl = null; }
  if (map.base.kind === 'image') {
    const blob = await db.getBlob('base:' + map.id);
    baseCanvas.hidden = true;
    baseImage.hidden = false;
    if (blob) {
      E.baseUrl = URL.createObjectURL(blob);
      baseImage.src = E.baseUrl;
      try { await baseImage.decode(); } catch { /* shown when ready */ }
    }
    E.baseSource = baseImage;
  } else {
    baseImage.hidden = true;
    baseImage.removeAttribute('src');
    baseCanvas.hidden = false;
    baseCanvas.width = map.width;
    baseCanvas.height = map.height;
    paintParchment(baseCanvas.getContext('2d'), map.width, map.height, map.base.style, map.base.seed);
    E.baseSource = baseCanvas;
  }

  terrainCanvas.width = Math.round(map.width * E.ts);
  terrainCanvas.height = Math.round(map.height * E.ts);
  E.tctx = terrainCanvas.getContext('2d', { willReadFrequently: false });
  E.tctx.clearRect(0, 0, terrainCanvas.width, terrainCanvas.height);
  const tb = await db.getBlob('terrain:' + map.id);
  if (tb) {
    const bmp = await createImageBitmap(tb);
    E.tctx.drawImage(bmp, 0, 0, terrainCanvas.width, terrainCanvas.height);
    bmp.close?.();
  }

  E.dirtyFog = false;
  await attachFog(map, map.fog?.on ? await db.getBlob('fog:' + map.id) : null);

  renderMapList();
  renderLayers();
  renderAll();
  renderParty();
  renderInspector();
  updateUndoButtons();
  fit();
}

// ------------------------------------------------------------------ view

function vpRect() { return vp.getBoundingClientRect(); }

/** The part of the map on screen, as fractions of the map, for the player window to follow. */
function viewRect() {
  const r = vpRect(), m = E.map;
  const x0 = (RAIL - E.panX) / E.zoom, y0 = -E.panY / E.zoom, x1 = (r.width - E.panX) / E.zoom, y1 = (r.height - E.panY) / E.zoom;
  const c = (v, max) => Math.max(0, Math.min(1, v / max));
  return { x0: c(x0, m.width), y0: c(y0, m.height), x1: c(x1, m.width), y1: c(y1, m.height) };
}

const RAIL = 76; // room kept clear for the floating toolrail

function fitZoom() {
  const r = vpRect();
  return Math.min((r.width - RAIL - 70) / E.map.width, (r.height - 80) / E.map.height);
}

function fit() {
  const r = vpRect();
  E.zoom = fitZoom();
  E.panX = RAIL + (r.width - RAIL - E.map.width * E.zoom) / 2;
  E.panY = (r.height - E.map.height * E.zoom) / 2;
  applyView();
}

function clampPan() {
  const r = vpRect();
  const w = E.map.width * E.zoom, h = E.map.height * E.zoom;
  const m = 120;
  E.panX = Math.min(r.width - m, Math.max(m - w, E.panX));
  E.panY = Math.min(r.height - m, Math.max(m - h, E.panY));
}

function zoomAt(z, sx, sy) {
  const min = Math.min(fitZoom() * 0.5, 0.5), max = 8;
  z = Math.min(max, Math.max(min, z));
  const mx = (sx - E.panX) / E.zoom, my = (sy - E.panY) / E.zoom;
  E.zoom = z;
  E.panX = sx - mx * z;
  E.panY = sy - my * z;
  clampPan();
  applyView();
}

function zoomBy(f) {
  const r = vpRect();
  zoomAt(E.zoom * f, r.width / 2, r.height / 2);
}

function centerOn(x, y, z = Math.max(E.zoom, 1)) {
  const r = vpRect();
  const from = { x: E.panX, y: E.panY, z: E.zoom };
  const to = { z, x: r.width / 2 - x * z, y: r.height / 2 - y * z };
  const t0 = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = now => {
    const t = reduce ? 1 : Math.min(1, (now - t0) / 380);
    const k = 1 - Math.pow(1 - t, 3);
    E.zoom = from.z + (to.z - from.z) * k;
    E.panX = from.x + (to.x - from.x) * k;
    E.panY = from.y + (to.y - from.y) * k;
    applyView();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let lastPinZoom = 0;
function applyView() {
  worldEl.style.transform = `translate(${E.panX}px, ${E.panY}px) scale(${E.zoom})`;
  if (E.map) viewChanged();
  $('#zoom-read').textContent = Math.round(E.zoom * 100) + '%';
  terrainCanvas.style.imageRendering = E.zoom > 2.5 ? 'pixelated' : 'auto';
  if (Math.abs(lastPinZoom - E.zoom) > 1e-4) {
    lastPinZoom = E.zoom;
    updatePinScale();
    renderHandles();
    renderDraft();
  }
  updateScalebar();
}

function toMap(e) {
  const r = vpRect();
  return [(e.clientX - r.left - E.panX) / E.zoom, (e.clientY - r.top - E.panY) / E.zoom];
}

function updateScalebar() {
  const m = E.map;
  const perUnitPx = (m.grid.size / (m.scale.perCell || 1)) * E.zoom;
  const nice = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
  let n = nice.find(v => v * perUnitPx >= 90) ?? nice[nice.length - 1];
  const px = n * perUnitPx;
  $('#scalebar .sb-bar').style.width = Math.round(px) + 'px';
  $('#sb-label').textContent = `${n} ${m.scale.unit}`;
}

// ------------------------------------------------------------------ render SVG

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  parent?.append(n);
  return n;
}

function renderAll() {
  renderGrid();
  renderRegions();
  renderRoutes();
  renderLabels();
  renderPins();
  renderHandles();
  renderDraft();
  applyLayerState();
  renderPlaces();
  renderLegend();
  updateScalebar();
}

/** GM-only items stay visible to the GM but are drawn faded, with a dashed outline. */
function secretClass(o) { return isSecret(o, entryMap()) ? ' secret' : ''; }

function renderGrid() {
  const m = E.map;
  G.grid.innerHTML = '';
  if (m.grid.type === 'none') return;
  const d = m.grid.type === 'hex' ? hexPath(m.width, m.height, m.grid.size) : squarePath(m.width, m.height, m.grid.size);
  el('path', { d, fill: 'none', stroke: hexToRgba(m.grid.color, m.grid.opacity), 'stroke-width': 1.2, 'clip-path': 'url(#map-clip)' }, G.grid);
  const defs = $('#overlay-defs');
  let cp = $('#map-clip', defs);
  if (!cp) { cp = el('clipPath', { id: 'map-clip' }, defs); el('rect', {}, cp); }
  const rect = cp.firstChild;
  rect.setAttribute('width', m.width); rect.setAttribute('height', m.height);
}

function renderRegions() {
  G.regions.innerHTML = '';
  const defs = $('#overlay-defs');
  $$('clipPath.rclip', defs).forEach(n => n.remove());
  for (const r of E.map.objects.regions) {
    if (r.points.length < 3) continue;
    const d = pathFor(r.points, { closed: true, smooth: r.smooth });
    const cp = el('clipPath', { id: 'rc-' + r.id, class: 'rclip' }, defs);
    el('path', { d }, cp);
    const g = el('g', { class: 'obj region' + secretClass(r) + (isSel('region', r.id) ? ' selected' : ''), 'data-type': 'region', 'data-id': r.id }, G.regions);
    const rc = regionColor(r, entryMap());
    el('path', { d, fill: hexToRgba(rc, r.fill ?? 0.18), class: 'rg-fill' }, g);
    el('path', { d, fill: 'none', stroke: hexToRgba(rc, 0.35), 'stroke-width': 18, 'clip-path': `url(#rc-${r.id})` }, g);
    if (r.border !== 'none') el('path', { d, fill: 'none', stroke: rc, 'stroke-width': 3, 'stroke-dasharray': r.border === 'dashed' ? '14 9' : null, class: 'rg-border' }, g);
    if (r.showName && nameOf(r, entryMap())) {
      const [cx, cy] = centroid(r.points);
      textEl(g, nameOf(r, entryMap()), cx, cy, 'region', r.nameSize || 40, rc, 0);
    }
  }
}

function routeEls(parent, rt, extraClass = '') {
  const k = ROUTE_KINDS[rt.kind] || ROUTE_KINDS.road;
  const w = rt.width || k.width;
  const d = pathFor(rt.points, { smooth: rt.smooth !== false });
  const g = el('g', { class: 'obj route' + secretClass(rt) + ' ' + extraClass, 'data-type': 'route', 'data-id': rt.id }, parent);
  el('path', { d, class: 'hit', fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(w * 3, 24) }, g);
  el('path', {
    d, fill: 'none', stroke: rt.color || k.color, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'stroke-dasharray': k.dash ? k.dash.map(v => v * w).join(' ') : null, class: 'rt-main',
  }, g);
  if (rt.kind === 'road') el('path', { d, fill: 'none', stroke: 'rgba(236,222,186,0.9)', 'stroke-width': w * 0.42, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, g);
  return g;
}

function renderRoutes() {
  G.routes.innerHTML = '';
  for (const rt of E.map.objects.routes) {
    if (rt.points.length < 2) continue;
    routeEls(G.routes, rt, isSel('route', rt.id) ? 'selected' : '');
  }
}

function textEl(parent, text, x, y, style, size, color, rotation, attrs = {}) {
  const s = LABEL_STYLES[style] || LABEL_STYLES.region;
  const t = el('text', {
    x, y,
    'font-family': `"${s.family}", serif`, 'font-weight': s.weight, 'font-style': s.italic ? 'italic' : 'normal',
    'font-size': size, 'letter-spacing': (s.spacing * size).toFixed(2),
    fill: color || s.color, 'text-anchor': 'middle', 'dominant-baseline': 'central',
    stroke: 'rgba(240,228,198,0.75)', 'stroke-width': Math.max(2, size * 0.14), 'stroke-linejoin': 'round', 'paint-order': 'stroke',
    transform: rotation ? `rotate(${rotation} ${x} ${y})` : null,
    ...attrs,
  }, parent);
  t.textContent = text;
  return t;
}

function renderLabels() {
  G.labels.innerHTML = '';
  for (const lb of E.map.objects.labels) {
    textEl(G.labels, lb.text || ' ', lb.x, lb.y, lb.style, lb.size, lb.color, lb.rotation, {
      class: 'obj label' + secretClass(lb) + (isSel('label', lb.id) ? ' selected' : ''), 'data-type': 'label', 'data-id': lb.id,
    });
  }
}

function pinScale() { return 1.15 / E.zoom; }

function renderPins() {
  G.pins.innerHTML = '';
  const s = pinScale();
  const showNames = E.map.showPinNames !== false;
  for (const p of E.map.objects.pins) {
    const g = el('g', { class: 'obj pin' + secretClass(p) + (isSel('pin', p.id) ? ' selected' : ''), 'data-type': 'pin', 'data-id': p.id, transform: `translate(${p.x} ${p.y}) scale(${s})` }, G.pins);
    el('ellipse', { rx: 6, ry: 2.5, class: 'pin-shadow' }, g);
    el('path', { d: PIN_BODY, fill: p.color, class: 'pin-body' }, g);
    el('circle', { cx: 0, cy: PIN_HEAD_Y, r: 9.5, class: 'pin-head' }, g);
    const gl = el('g', { transform: `translate(-7.5 ${PIN_HEAD_Y - 7.5}) scale(0.625)` }, g);
    el('path', { d: (PIN_ICONS[p.icon] || PIN_ICONS.marker).d, class: 'pin-glyph' }, gl);
    if (p.childMapId) {
      el('circle', { cx: 12, cy: -32, r: 7, class: 'pin-nest' }, g);
      el('path', { d: 'M9.6 -35.2L15 -32 9.6 -28.8z', class: 'pin-nest-arrow' }, g);
    }
    if (showNames && nameOf(p, entryMap())) textEl(g, nameOf(p, entryMap()), 0, 14, 'settlement', 15, '#2a1d10', 0, { class: 'pin-name' });
  }
}

function updatePinScale() {
  const s = pinScale();
  for (const g of G.pins.children) {
    const p = E.map.objects.pins.find(p => p.id === g.dataset.id);
    if (p) g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${s})`);
  }
}

function renderHandles() {
  G.handles.innerHTML = '';
  if (!E.map || !E.sel) return;
  const o = getSel();
  if (!o) return;
  const r = 5.5 / E.zoom;
  if (E.sel.type === 'region' || E.sel.type === 'route') {
    if (E.map.layers[TYPE_LAYER[E.sel.type]].locked) return;
    o.points.forEach((p, i) => {
      el('circle', { cx: p[0], cy: p[1], r, class: 'handle', 'data-vertex': i, 'stroke-width': 1.6 / E.zoom }, G.handles);
    });
    // midpoints add a new vertex when dragged
    const n = o.points.length;
    const segs = E.sel.type === 'region' ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const a = o.points[i], b = o.points[(i + 1) % n];
      el('circle', { cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, r: r * 0.7, class: 'handle handle-mid', 'data-mid': i, 'stroke-width': 1.2 / E.zoom }, G.handles);
    }
  } else if (E.sel.type === 'label') {
    const t = G.labels.querySelector(`[data-id="${o.id}"]`);
    if (t) {
      try {
        const b = t.getBBox();
        const pad = 6 / E.zoom;
        el('rect', {
          x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2, class: 'sel-box',
          'stroke-width': 1.4 / E.zoom, 'stroke-dasharray': `${5 / E.zoom} ${4 / E.zoom}`,
          transform: o.rotation ? `rotate(${o.rotation} ${o.x} ${o.y})` : null,
        }, G.handles);
      } catch { /* not rendered */ }
    }
  }
}

function renderDraft() {
  G.draft.innerHTML = '';
  if (!E.map) return;
  const z = E.zoom;
  if (E.draft) {
    const pts = E.draft.cursor ? [...E.draft.points, E.draft.cursor] : E.draft.points;
    if (pts.length >= 2) {
      if (E.draft.type === 'route') {
        const tmp = { id: 'draft', points: pts, kind: E.draft.kind, smooth: true };
        routeEls(G.draft, tmp, 'draft');
      } else {
        el('path', { d: pathFor(pts, { closed: pts.length > 2 }), class: 'draft-poly', 'stroke-width': 2 / z, 'stroke-dasharray': `${6 / z} ${4 / z}` }, G.draft);
      }
    }
    E.draft.points.forEach((p, i) => el('circle', { cx: p[0], cy: p[1], r: (i === 0 && E.draft.type === 'region' ? 7 : 4.5) / z, class: 'draft-pt' + (i === 0 ? ' first' : ''), 'stroke-width': 1.5 / z }, G.draft));
  }
  if (E.measure) {
    const [a, b] = [E.measure.a, E.measure.b];
    el('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], class: 'measure-line', 'stroke-width': 2.2 / z, 'stroke-dasharray': `${8 / z} ${5 / z}` }, G.draft);
    for (const p of [a, b]) el('circle', { cx: p[0], cy: p[1], r: 4 / z, class: 'measure-end', 'stroke-width': 1.5 / z }, G.draft);
  }
}

// ------------------------------------------------------------------ layers

function applyLayerState() {
  const L = E.map.layers;
  baseCanvas.style.visibility = L.base.visible ? '' : 'hidden';
  baseImage.style.visibility = L.base.visible ? '' : 'hidden';
  terrainCanvas.style.visibility = L.terrain.visible ? '' : 'hidden';
  for (const k of ['grid', 'regions', 'routes', 'labels', 'pins']) {
    G[k].style.display = L[k].visible ? '' : 'none';
    G[k].classList.toggle('locked', !!L[k].locked);
  }
}

function renderLayers() {
  const L = E.map.layers;
  $('#layer-list').innerHTML = LAYER_ORDER.map(k => `
    <li class="layer ${L[k].visible ? '' : 'is-hidden'}" data-layer="${k}">
      <button class="lyr-btn lyr-eye" data-act="eye" title="${L[k].visible ? 'Hide' : 'Show'} ${LAYER_NAMES[k]}" aria-pressed="${L[k].visible}">${icon(L[k].visible ? 'eye' : 'eyeOff')}</button>
      <span class="lyr-name">${LAYER_NAMES[k]}</span>
      <button class="lyr-btn lyr-lock ${L[k].locked ? 'on' : ''}" data-act="lock" title="${L[k].locked ? 'Unlock' : 'Lock'} ${LAYER_NAMES[k]}" aria-pressed="${L[k].locked}">${icon(L[k].locked ? 'lock' : 'unlock')}</button>
    </li>`).join('');
  $$('#layer-list button').forEach(b => b.onclick = () => {
    const k = b.closest('li').dataset.layer;
    const l = E.map.layers[k];
    if (b.dataset.act === 'eye') l.visible = !l.visible; else l.locked = !l.locked;
    if (E.sel && TYPE_LAYER[E.sel.type] === k && (l.locked || !l.visible)) select(null);
    renderLayers(); applyLayerState(); renderHandles(); markDirty();
  });
}

// ------------------------------------------------------------------ map list

function renderMapList() {
  $('#map-list').innerHTML = outline(E.maps).map(({ map: m, depth }) => `
    <li class="map-item ${m.id === E.map?.id ? 'active' : ''}" data-id="${m.id}" style="--depth:${Math.min(depth, 5)}">
      <button class="mi-open" title="Open ${esc(m.name)}">${icon(depth ? 'chevron' : 'map')}<span>${esc(m.name)}</span></button>
      <button class="mi-act" data-act="rename" title="Rename map">${icon('edit')}</button>
      <button class="mi-act" data-act="delete" title="Delete map">${icon('trash')}</button>
    </li>`).join('');
  $$('#map-list .map-item').forEach(li => {
    const id = li.dataset.id;
    $('.mi-open', li).onclick = () => { if (id !== E.map.id) loadMap(id); };
    $('.mi-open', li).ondblclick = () => renameMap(id);
    $('[data-act=rename]', li).onclick = () => renameMap(id);
    $('[data-act=delete]', li).onclick = () => deleteMap(id);
  });
}

async function renameMap(id) {
  const m = E.maps.find(m => m.id === id);
  const n = await promptBox('Rename map', 'Map name', m.name, 'Rename');
  if (!n) return;
  m.name = n;
  if (m.id === E.map.id) { markDirty(); renderInspector(); }
  else { m.updated = Date.now(); await db.putMap(m); }
  renderCrumbs();
  renderMapList();
}

async function deleteMap(id) {
  if (E.maps.length === 1) { toast('A world needs at least one map.', 'bad'); return; }
  const m = E.maps.find(m => m.id === id);
  const ok = await confirmBox('Delete this map?', `<strong>${esc(m.name)}</strong>, its terrain paint and every pin, label, region and route on it will be removed.${E.maps.some(x => x.parentMapId === id) ? ' Maps inside it stay, and move up to the top level.' : ''} This cannot be undone.`, { okLabel: 'Delete map' });
  if (!ok) return;
  if (id === E.map.id) { E.dirtyMap = false; E.dirtyTerrain = false; E.dirtyFog = false; clearTimeout(E.saveTimer); }
  await db.deleteMap(id);
  if (E.world.party?.mapId === id) { delete E.world.party; await db.putWorld(E.world); renderParty(); }
  E.maps = E.maps.filter(x => x.id !== id);
  for (const x of E.maps) {
    let changed = false;
    if (x.parentMapId === id) { x.parentMapId = null; changed = true; }
    for (const p of x.objects.pins) if (p.childMapId === id) { p.childMapId = null; changed = true; }
    if (changed) { if (x === E.map && x.id !== id) markDirty(); else { x.updated = Date.now(); db.putMap(x); } }
  }
  E.maps.forEach((x, i) => { if (x.order !== i) { x.order = i; db.putMap(x); } });
  if (id === E.map.id) { E.map = null; await loadMap(E.maps[0].id); }
  else renderMapList();
  toast('Map deleted');
}

async function addMap() {
  const res = await newMapDialog({ title: 'Add a map' });
  if (!res) return;
  await flush();
  const m = await saveNewMap(E.world.id, res, E.maps.length);
  E.maps.push(m);
  await loadMap(m.id);
}

// ------------------------------------------------------------------ places

function placeName(type, o) {
  if (type === 'label') return o.text;
  return nameOf(o, entryMap()) || `Unnamed ${TYPE_NAME[type].toLowerCase()}`;
}

function renderPlaces() {
  if (!E.map) return;
  const q = $('#places-search').value.trim().toLowerCase();
  const o = E.map.objects;
  const groups = [
    ['pin', 'Pins', o.pins],
    ['region', 'Regions', o.regions],
    ['route', 'Routes', o.routes],
    ['label', 'Labels', o.labels],
  ];
  let total = 0, html = '';
  for (const [type, title, list] of groups) {
    const items = list.filter(x => {
      if (!q) return true;
      const e = linkedEntry(x);
      return [placeName(type, x), e ? plainText(e.body) : '', e ? e.tags.join(' ') : '', isSecret(x, entryMap()) ? 'secret' : ''].join(' ').toLowerCase().includes(q);
    });
    total += list.length;
    if (!items.length) continue;
    html += `<div class="pl-group"><p class="pl-title">${title}</p>` + items.map(x => {
      const ico = type === 'pin' ? `<span class="pl-ico" style="--c:${x.color}">${pinGlyph(x.icon)}</span>`
        : type === 'region' ? `<span class="pl-ico pl-swatch" style="--c:${regionColor(x, entryMap())}"></span>`
        : type === 'route' ? `<span class="pl-ico pl-line" style="--c:${x.color || ROUTE_KINDS[x.kind].color}"></span>`
        : `<span class="pl-ico pl-text">Aa</span>`;
      const unnamed = type !== 'label' && !nameOf(x, entryMap());
      return `<button class="pl-item ${isSel(type, x.id) ? 'active' : ''} ${unnamed ? 'unnamed' : ''}" data-type="${type}" data-id="${x.id}">${ico}<span>${esc(placeName(type, x))}</span>${isSecret(x, entryMap()) ? `<span class="pl-secret" title="Secret: hidden from players">${icon('lock')}</span>` : ''}</button>`;
    }).join('') + '</div>';
  }
  $('#places-count').textContent = total || '';
  $('#places').innerHTML = html || (q
    ? `<p class="pl-empty">Nothing matches “${esc(q)}”.</p>`
    : `<p class="pl-empty">Places you add to this map show up here. Press <kbd>P</kbd> to drop a pin.</p>`);
  $$('#places .pl-item').forEach(b => b.onclick = () => {
    select({ type: b.dataset.type, id: b.dataset.id });
    const obj = getSel();
    if (!obj) return;
    let c;
    if (obj.points) c = b.dataset.type === 'region' ? centroid(obj.points) : obj.points[Math.floor(obj.points.length / 2)];
    else c = [obj.x, obj.y];
    centerOn(c[0], c[1]);
  });
}

// ------------------------------------------------------------------ selection

function isSel(type, id) { return E.sel && E.sel.type === type && E.sel.id === id; }

function getSel() {
  if (!E.sel || !E.map) return null;
  return E.map.objects[TYPE_LIST[E.sel.type]].find(o => o.id === E.sel.id) || null;
}

function select(s, { focus = false } = {}) {
  E.sel = s;
  if (s && !getSel()) E.sel = null;
  for (const n of $$('.obj.selected', overlay)) n.classList.remove('selected');
  if (E.sel) overlay.querySelector(`.obj[data-type="${E.sel.type}"][data-id="${E.sel.id}"]`)?.classList.add('selected');
  renderHandles();
  renderInspector();
  $$('#places .pl-item').forEach(b => b.classList.toggle('active', !!E.sel && b.dataset.id === E.sel.id));
  if (focus) setTimeout(() => $('#inspector [data-focus]')?.select?.(), 20);
}

function rerenderType(type) {
  ({ pin: renderPins, label: renderLabels, region: renderRegions, route: renderRoutes })[type]();
  renderHandles();
}

// ------------------------------------------------------------------ history

function snapshot() { return JSON.stringify(E.map.objects); }

function pushObjects(snap) {
  E.undo.push({ kind: 'objects', data: snap });
  if (E.undo.length > 80) E.undo.shift();
  E.redo = [];
  updateUndoButtons();
}

function checkpoint() { pushObjects(snapshot()); }

function pushPaint(entry) {
  E.undo.push(entry);
  // keep paint memory bounded
  // keep paint memory bounded: at most 30 steps and about 200 MB of saved pixels (the newest step always stays)
  const bytes = u => u.before.data.length + u.after.data.length;
  let paints = E.undo.filter(u => u.kind === 'paint' || u.kind === 'fog');
  let total = paints.reduce((n, u) => n + bytes(u), 0);
  while (paints.length > 1 && (paints.length > 30 || total > 200e6)) { total -= bytes(paints[0]); E.undo.splice(E.undo.indexOf(paints[0]), 1); paints.shift(); }
  E.redo = [];
  updateUndoButtons();
}

function applyHistory(from, to) {
  const h = from.pop();
  if (!h) return;
  if (h.kind === 'objects') {
    to.push({ kind: 'objects', data: snapshot() });
    E.map.objects = JSON.parse(h.data);
    if (E.sel && !getSel()) E.sel = null;
    renderAll();
    renderInspector();
    markDirty();
  } else if (h.kind === 'fog') {
    applyFogHistory(h, from === E.undo);
    to.push(h);
    if (E.tool === 'fog') renderInspector();
  } else if (h.kind === 'paint') {
    const isUndo = from === E.undo;
    E.tctx.putImageData(isUndo ? h.before : h.after, h.x, h.y);
    to.push(h);
    markTerrainDirty();
  }
  updateUndoButtons();
}

function undo() { applyHistory(E.undo, E.redo); }
function redo() { applyHistory(E.redo, E.undo); }

function updateUndoButtons() {
  $('#btn-undo').disabled = !E.undo.length;
  $('#btn-redo').disabled = !E.redo.length;
}

// ------------------------------------------------------------------ saving

function setSaveState(s) {
  const n = $('#save-state');
  n.dataset.state = s;
  n.textContent = s === 'saving' ? 'Saving…' : s === 'dirty' ? 'Unsaved' : s === 'error' ? 'Not saved' : 'Saved';
}

function markDirty() {
  E.dirtyMap = true;
  scheduleSave();
  tableChanged();
}

function markFogDirty() {
  E.dirtyFog = true;
  scheduleSave();
}

function markTerrainDirty() {
  E.dirtyTerrain = true;
  scheduleSave();
  tableChanged();
}

function scheduleSave() {
  setSaveState('dirty');
  clearTimeout(E.saveTimer);
  E.saveTimer = setTimeout(flush, 900);
}

async function flush() {
  clearTimeout(E.saveTimer);
  if (E.saving) await E.saving;
  if (!E.map || (!E.dirtyMap && !E.dirtyTerrain && !E.dirtyFog)) return;
  const map = E.map;
  const doTerrain = E.dirtyTerrain, doFog = E.dirtyFog;
  E.dirtyMap = false; E.dirtyTerrain = false; E.dirtyFog = false;
  setSaveState('saving');
  E.saving = (async () => {
    try {
      map.updated = Date.now();
      await db.putMap(map);
      if (doTerrain) {
        const blob = await new Promise(r => terrainCanvas.toBlob(r, 'image/png'));
        if (blob) await db.putBlob('terrain:' + map.id, blob);
      }
      if (doFog) {
        const fb = map.fog?.on ? await fogBlob() : null;
        if (fb) await db.putBlob('fog:' + map.id, fb); else await db.deleteBlob('fog:' + map.id);
      }
      if (Date.now() - E.lastThumb > 4000) { E.lastThumb = Date.now(); await saveThumb(map); }
      await touchWorld(map.worldId);
      if (E.map === map && !E.dirtyMap && !E.dirtyTerrain && !E.dirtyFog) setSaveState('saved');
    } catch (err) {
      console.error(err);
      setSaveState('error');
      toast('Saving failed. Your browser may be out of storage space. Export the world to keep a copy.', 'bad', 6000);
    }
  })();
  await E.saving;
  E.saving = null;
}

async function saveThumb(map) {
  const W = 480;
  const scale = W / map.width;
  const c = document.createElement('canvas');
  c.width = W; c.height = Math.round(map.height * scale);
  renderMap(c.getContext('2d'), map, { base: E.baseSource, terrain: terrainCanvas }, { scale, pinScale: 0.45 / scale, withGrid: false, pinNames: false });
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  if (blob) await db.putBlob('thumb:' + map.worldId, blob);
}

// ------------------------------------------------------------------ toolrail

function buildToolrail() {
  $('#toolrail').innerHTML = TOOLS.map(t => t
    ? `<button class="tool" data-tool="${t.id}" aria-label="${t.name}" data-tip="${t.name}" data-key="${t.key}">${icon(t.icon)}<kbd>${t.key}</kbd></button>`
    : '<span class="tool-sep"></span>').join('');
  $$('#toolrail .tool').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  setTool('select');
}

function setTool(t) {
  if (E.draft && E.draft.type !== t) finishDraft();
  if (t !== 'measure') { E.measure = null; $('#measure-tag').hidden = true; }
  E.tool = t;
  vp.dataset.tool = t;
  $$('#toolrail .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
  $('#brush-cursor').hidden = !(t === 'brush' || t === 'eraser' || t === 'fog');
  toolChanged(t);
  updateHint();
  if (E.map) { renderDraft(); renderInspector(); }
}

function updateHint() {
  const h = $('#hint');
  const msgs = {
    pin: 'Click the map to drop a pin.',
    label: 'Click the map to place a label.',
    region: E.draft ? 'Keep clicking to outline. Click the first point, double-click, or press Enter to close. Esc cancels.' : 'Click to start outlining a region.',
    route: E.draft ? 'Keep clicking to add bends. Double-click or press Enter to finish. Esc cancels.' : 'Click to start a route.',
    measure: 'Drag across the map to measure.',
    fog: 'Drag to uncover the map for your players. Switch to Cover to hide parts again.',
    party: 'Click the map to place the party, or to travel there.',
  };
  const m = msgs[E.tool];
  h.hidden = !m;
  if (m) h.textContent = m;
}

// ------------------------------------------------------------------ creating objects

function layerLocked(type) {
  const k = TYPE_LAYER[type];
  const L = E.map.layers[k];
  if (L.locked || !L.visible) {
    toast(`The ${LAYER_NAMES[k]} layer is ${L.locked ? 'locked' : 'hidden'}. Change it in Layers to edit.`, 'bad');
    return true;
  }
  return false;
}

function addPin(x, y) {
  if (layerLocked('pin')) return;
  checkpoint();
  const last = E.map.objects.pins[E.map.objects.pins.length - 1];
  const p = { id: uid('p'), x, y, name: '', icon: last?.icon || 'town', color: last?.color || PALETTE[0].hex, secret: false };
  E.map.objects.pins.push(p);
  renderPins(); renderPlaces(); markDirty();
  select({ type: 'pin', id: p.id }, { focus: true });
}

function addLabel(x, y) {
  if (layerLocked('label')) return;
  checkpoint();
  const style = E.map.objects.labels[E.map.objects.labels.length - 1]?.style || 'region';
  const l = { id: uid('l'), x, y, text: 'New label', style, size: Math.round(LABEL_STYLES[style].size * Math.max(1, E.map.width / 2200)), rotation: 0, color: null, secret: false };
  E.map.objects.labels.push(l);
  renderLabels(); renderPlaces(); markDirty();
  select({ type: 'label', id: l.id }, { focus: true });
}

function finishDraft() {
  const d = E.draft;
  E.draft = null;
  if (!d) return;
  const min = d.type === 'region' ? 3 : 2;
  if (d.points.length >= min) {
    checkpoint();
    let obj;
    if (d.type === 'region') {
      obj = { id: uid('r'), name: '', nameSize: Math.round(40 * Math.max(1, E.map.width / 2200)), points: d.points, color: PALETTE[(E.map.objects.regions.length) % PALETTE.length].hex, fill: 0.18, border: 'solid', smooth: false, showName: true, secret: false };
      E.map.objects.regions.push(obj);
      renderRegions();
    } else {
      obj = { id: uid('t'), name: '', points: d.points, kind: d.kind || 'road', color: null, width: null, smooth: true, secret: false };
      E.map.objects.routes.push(obj);
      renderRoutes();
    }
    renderPlaces(); markDirty();
    select({ type: d.type, id: obj.id }, { focus: true });
  }
  renderDraft();
  updateHint();
}

function deleteSelection() {
  const o = getSel();
  if (!o) return;
  if (E.map.layers[TYPE_LAYER[E.sel.type]].locked) return;
  checkpoint();
  const list = E.map.objects[TYPE_LIST[E.sel.type]];
  list.splice(list.indexOf(o), 1);
  const type = E.sel.type;
  E.sel = null;
  rerenderType(type);
  renderPlaces(); renderInspector(); markDirty();
}

function duplicateSelection() {
  const o = getSel();
  if (!o) return;
  checkpoint();
  const c = JSON.parse(JSON.stringify(o));
  c.id = uid(E.sel.type[0]);
  const off = 24 / E.zoom;
  if (c.points) c.points = c.points.map(p => [p[0] + off, p[1] + off]); else { c.x += off; c.y += off; }
  E.map.objects[TYPE_LIST[E.sel.type]].push(c);
  const type = E.sel.type;
  rerenderType(type);
  renderPlaces(); markDirty();
  select({ type, id: c.id });
}

// ------------------------------------------------------------------ terrain painting

let beforeCanvas = null;
let strokeCanvas = null;

function startStroke(m) {
  if (E.map.layers.terrain.locked || !E.map.layers.terrain.visible) {
    toast('The Terrain paint layer is locked or hidden. Change it in Layers to paint.', 'bad');
    return false;
  }
  if (!beforeCanvas) beforeCanvas = document.createElement('canvas');
  beforeCanvas.width = terrainCanvas.width;
  beforeCanvas.height = terrainCanvas.height;
  beforeCanvas.getContext('2d', { willReadFrequently: true }).drawImage(terrainCanvas, 0, 0);
  const s = { last: m, carry: 0, box: [Infinity, Infinity, -Infinity, -Infinity] };
  s.wet = E.tool === 'brush' && E.brush.mode === 'paint';
  if (s.wet) {
    if (strokeCanvas.width !== terrainCanvas.width || strokeCanvas.height !== terrainCanvas.height) {
      strokeCanvas.width = terrainCanvas.width; strokeCanvas.height = terrainCanvas.height;
    }
    strokeCanvas.style.opacity = E.brush.strength;
    strokeCanvas.hidden = false;
  }
  E.drag = { kind: 'stroke', stroke: s };
  strokeTo(m, true);
  return true;
}

function grow(box, x, y, r) {
  box[0] = Math.min(box[0], x - r); box[1] = Math.min(box[1], y - r);
  box[2] = Math.max(box[2], x + r); box[3] = Math.max(box[3], y + r);
}

function strokeTo(m, first = false) {
  const s = E.drag.stroke;
  const ts = E.ts, b = E.brush, ctx = E.tctx;
  const size = (b.size / E.zoom) * ts; // brush size is in screen pixels
  const [x0, y0] = s.last.map(v => v * ts);
  const [x1, y1] = m.map(v => v * ts);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const rnd = Math.random;
  const sctx = strokeCanvas.getContext('2d');

  if (E.tool === 'brush' && b.mode === 'stamp' && b.stamp === 'ink') {
    ctx.save();
    ctx.strokeStyle = INK; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = Math.min(1, b.strength + 0.2);
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(first ? x1 + 0.01 : x1, y1); ctx.stroke();
    ctx.restore();
    grow(s.box, x0, y0, size * 0.1); grow(s.box, x1, y1, size * 0.1);
    s.last = m;
    return;
  }

  let spacing;
  if (E.tool === 'eraser' || b.mode === 'paint') spacing = Math.max(1, size * 0.18);
  else spacing = Math.max(2, size * (STAMP_SPACING[b.stamp] || 0.6) * b.spacing);

  const place = (x, y) => {
    if (E.tool === 'eraser') { eraseDab(ctx, x, y, size / 2, b.strength); grow(s.box, x, y, size / 2); }
    else if (b.mode === 'paint') { paintDab(sctx, x, y, size / 2, PAINTS[b.paint].color); grow(s.box, x, y, size / 2); }
    else {
      const jx = (rnd() - 0.5) * size * 0.35, jy = (rnd() - 0.5) * size * 0.35;
      const sz = size * (0.8 + rnd() * 0.35);
      drawStamp(ctx, b.stamp, x + jx, y + jy, sz, b.strength, rnd);
      grow(s.box, x + jx, y + jy, sz * 1.6);
    }
  };

  if (first) { place(x1, y1); s.last = m; return; }
  let t = spacing - s.carry;
  while (t <= dist) {
    const k = t / dist;
    place(x0 + (x1 - x0) * k, y0 + (y1 - y0) * k);
    t += spacing;
  }
  s.carry = dist - (t - spacing);
  s.last = m;
}

function endStroke(d) {
  const s = d.stroke;
  const W = terrainCanvas.width, H = terrainCanvas.height;
  const x = Math.max(0, Math.floor(s.box[0])), y = Math.max(0, Math.floor(s.box[1]));
  const x2 = Math.min(W, Math.ceil(s.box[2])), y2 = Math.min(H, Math.ceil(s.box[3]));
  if (s.wet) {
    const sctx = strokeCanvas.getContext('2d');
    if (x2 > x && y2 > y) {
      // texture the wet paint, then lay it onto the terrain at the chosen strength
      sctx.save();
      sctx.globalCompositeOperation = 'destination-out';
      sctx.fillStyle = sctx.createPattern(grain(), 'repeat');
      sctx.fillRect(x, y, x2 - x, y2 - y);
      sctx.restore();
      E.tctx.save();
      E.tctx.globalAlpha = E.brush.strength;
      E.tctx.drawImage(strokeCanvas, x, y, x2 - x, y2 - y, x, y, x2 - x, y2 - y);
      E.tctx.restore();
    }
    sctx.clearRect(0, 0, W, H);
    strokeCanvas.hidden = true;
  }
  if (x2 > x && y2 > y) {
    const before = beforeCanvas.getContext('2d', { willReadFrequently: true }).getImageData(x, y, x2 - x, y2 - y);
    const after = E.tctx.getImageData(x, y, x2 - x, y2 - y);
    pushPaint({ kind: 'paint', x, y, before, after });
    markTerrainDirty();
  }
}

function outlineCoasts() {
  if (E.map.layers.terrain.locked || !E.map.layers.terrain.visible) { toast('The Terrain paint layer is locked or hidden. Change it in Layers first.', 'bad'); return; }
  const W = terrainCanvas.width, H = terrainCanvas.height;
  const before = E.tctx.getImageData(0, 0, W, H);
  let found = 0;
  try { found = outlineCoast(E.tctx, W, H); }
  catch (err) { console.error(err); E.tctx.putImageData(before, 0, 0); toast('That map is too large to outline in this browser.', 'bad'); return; }
  if (!found) { toast('Paint some shallows or deep sea first, then outline the coasts.', 'bad', 4200); return; }
  pushPaint({ kind: 'paint', x: 0, y: 0, before, after: E.tctx.getImageData(0, 0, W, H) });
  markTerrainDirty();
  toast('Coastlines inked. Undo with Ctrl+Z.');
}

async function clearTerrain() {
  const ok = await confirmBox('Clear all terrain paint?', 'Every brush stroke and stamp on this map will be wiped. You can undo this with Ctrl+Z.', { okLabel: 'Clear terrain' });
  if (!ok) return;
  const W = terrainCanvas.width, H = terrainCanvas.height;
  const before = E.tctx.getImageData(0, 0, W, H);
  E.tctx.clearRect(0, 0, W, H);
  const after = E.tctx.getImageData(0, 0, W, H);
  pushPaint({ kind: 'paint', x: 0, y: 0, before, after });
  markTerrainDirty();
  toast('Terrain cleared');
}

function updateBrushCursor(e) {
  const c = $('#brush-cursor');
  if (c.hidden) return;
  const r = vpRect();
  const d = E.tool === 'fog' ? fogBrushPx() : E.brush.size;
  c.style.width = c.style.height = d + 'px';
  c.style.transform = `translate(${e.clientX - r.left - d / 2}px, ${e.clientY - r.top - d / 2}px)`;
}

// ------------------------------------------------------------------ pointer input

function bindViewport() {
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    if (!E.map) return;
    const r = vpRect();
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(E.zoom * f, e.clientX - r.left, e.clientY - r.top);
    updateBrushCursor(e);
  }, { passive: false });

  vp.addEventListener('pointerdown', onDown);
  vp.addEventListener('pointermove', onMove);
  vp.addEventListener('pointerup', onUp);
  vp.addEventListener('pointercancel', onUp);
  vp.addEventListener('pointerleave', () => { $('#coords').textContent = ''; if (E.draft) { E.draft.cursor = null; renderDraft(); } });
  vp.addEventListener('dblclick', onDbl);
  vp.addEventListener('contextmenu', e => e.preventDefault());
}

function startPan(e) {
  E.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: E.panX, py: E.panY };
  vp.classList.add('panning');
}

function onDown(e) {
  if (!E.map) return;
  vp.focus({ preventScroll: true });
  if (e.button === 2) {
    if (E.draft) { E.draft.points.pop(); if (!E.draft.points.length) E.draft = null; renderDraft(); updateHint(); }
    return;
  }
  vp.setPointerCapture(e.pointerId);
  if (e.button === 1 || E.spaceDown || E.tool === 'pan') { startPan(e); return; }
  const m = toMap(e);

  switch (E.tool) {
    case 'select': {
      const vtx = e.target.closest('[data-vertex], [data-mid]');
      if (vtx && E.sel) {
        const o = getSel();
        const snap = snapshot();
        let index;
        if (vtx.dataset.mid !== undefined) {
          index = +vtx.dataset.mid + 1;
          pushObjects(snap);
          o.points.splice(index, 0, m);
          E.drag = { kind: 'vertex', index, snap: null };
        } else {
          index = +vtx.dataset.vertex;
          E.drag = { kind: 'vertex', index, snap };
        }
        return;
      }
      const objEl = e.target.closest('.obj');
      if (objEl) {
        const type = objEl.dataset.type, id = objEl.dataset.id;
        if (!isSel(type, id)) select({ type, id });
        const o = getSel();
        if (!o) return;
        if (e.altKey) { duplicateSelection(); }
        const cur = getSel();
        E.drag = {
          kind: 'move', start: m, snap: snapshot(), moved: false,
          orig: cur.points ? cur.points.map(p => [...p]) : [cur.x, cur.y],
        };
        return;
      }
      E.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: E.panX, py: E.panY, deselect: true };
      return;
    }
    case 'pin': addPin(...m); return;
    case 'label': addLabel(...m); return;
    case 'region':
    case 'route': {
      if (layerLocked(E.tool)) return;
      if (!E.draft) E.draft = { type: E.tool, points: [], cursor: null, kind: 'road' };
      const pts = E.draft.points;
      if (E.tool === 'region' && pts.length >= 3) {
        const f = pts[0];
        if (Math.hypot(f[0] - m[0], f[1] - m[1]) < 10 / E.zoom) { finishDraft(); return; }
      }
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last[0] - m[0], last[1] - m[1]) > 2 / E.zoom) pts.push(m);
      renderDraft(); updateHint();
      return;
    }
    case 'measure':
      E.measure = { a: m, b: m };
      E.drag = { kind: 'measure' };
      renderDraft();
      return;
    case 'brush':
    case 'eraser':
      startStroke(m);
      return;
    case 'fog':
      E.drag = { kind: 'fog' };
      tableDown('fog', m);
      return;
    case 'party':
      tableDown('party', m);
      return;
  }
}

function onMove(e) {
  if (!E.map) return;
  const m = toMap(e);
  updateBrushCursor(e);
  if (m[0] >= 0 && m[1] >= 0 && m[0] <= E.map.width && m[1] <= E.map.height) {
    $('#coords').textContent = `${Math.round(m[0])}, ${Math.round(m[1])}`;
  } else $('#coords').textContent = '';

  const d = E.drag;
  if (!d) {
    if (E.draft) { E.draft.cursor = m; renderDraft(); }
    return;
  }
  if (d.kind === 'pan') {
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) { d.deselect = false; vp.classList.add('panning'); }
    E.panX = d.px + dx; E.panY = d.py + dy;
    clampPan(); applyView();
  } else if (d.kind === 'move') {
    const o = getSel();
    if (!o) return;
    const dx = m[0] - d.start[0], dy = m[1] - d.start[1];
    if (!d.moved) {
      if (Math.hypot(dx, dy) * E.zoom < 3) return;
      if (E.map.layers[TYPE_LAYER[E.sel.type]].locked) return;
      d.moved = true; pushObjects(d.snap);
    }
    if (o.points) o.points = d.orig.map(p => [p[0] + dx, p[1] + dy]);
    else { o.x = d.orig[0] + dx; o.y = d.orig[1] + dy; }
    rerenderType(E.sel.type);
  } else if (d.kind === 'vertex') {
    const o = getSel();
    if (!o) return;
    if (d.snap) { pushObjects(d.snap); d.snap = null; }
    o.points[d.index] = m;
    rerenderType(E.sel.type);
  } else if (d.kind === 'measure') {
    E.measure.b = m;
    renderDraft();
    const tag = $('#measure-tag');
    const r = vpRect();
    tag.hidden = false;
    tag.textContent = formatDistance(Math.hypot(m[0] - E.measure.a[0], m[1] - E.measure.a[1]), E.map);
    tag.style.transform = `translate(${e.clientX - r.left + 14}px, ${e.clientY - r.top - 34}px)`;
  } else if (d.kind === 'stroke') {
    const ev = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of ev.length ? ev : [e]) strokeTo(toMap(ce));
  } else if (d.kind === 'fog') {
    const ev = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ce of ev.length ? ev : [e]) tableMove(toMap(ce));
  }
}

function onUp(e) {
  const d = E.drag;
  E.drag = null;
  vp.classList.remove('panning');
  if (!d) return;
  if (d.kind === 'pan' && d.deselect) select(null);
  if (d.kind === 'move' && d.moved) { markDirty(); renderPlaces(); renderInspector(); }
  if (d.kind === 'vertex') { markDirty(); renderInspector(); }
  if (d.kind === 'stroke') endStroke(d);
  if (d.kind === 'fog') tableUp();
}

function onDbl(e) {
  if (E.draft) {
    // the second click of a double-click already added a point; drop the duplicate
    const pts = E.draft.points;
    if (pts.length > 1) {
      const a = pts[pts.length - 1], b = pts[pts.length - 2];
      if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 6 / E.zoom) pts.pop();
    }
    finishDraft();
    return;
  }
  // The viewport holds pointer capture, so dblclick targets it rather than the thing under the cursor.
  const hit = document.elementFromPoint(e.clientX, e.clientY);
  const pinEl = E.tool === 'select' && hit?.closest('.obj.pin');
  if (pinEl) {
    const pin = E.map.objects.pins.find(p => p.id === pinEl.dataset.id);
    if (pin?.childMapId && E.maps.some(m => m.id === pin.childMapId)) { loadMap(pin.childMapId); return; }
  }
  if (E.tool === 'select' && hit?.closest('.obj.label')) {
    setTimeout(() => $('#inspector [data-focus]')?.select?.(), 20);
  }
}

// ------------------------------------------------------------------ keyboard

function bindKeys() {
  document.addEventListener('keydown', e => {
    if ($('#editor').hidden || document.querySelector('.dialog')) return;
    const typing = e.target.closest('input, textarea, select, [contenteditable]');
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openSwitcher(); return; }
    if (isWikiOpen()) return;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); flush().then(() => toast('Saved')); return; }
    if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); duplicateSelection(); return; }
    if (typing) { if (e.key === 'Escape') e.target.blur(); return; }
    if (mod || e.altKey) return;

    if (e.key === ' ') { e.preventDefault(); if (!E.spaceDown) { E.spaceDown = true; vp.classList.add('space'); } return; }
    if (e.key === 'Escape') {
      if (E.draft) { E.draft = null; renderDraft(); updateHint(); }
      else if (E.measure) { E.measure = null; renderDraft(); $('#measure-tag').hidden = true; }
      else select(null);
      return;
    }
    if (e.key === 'Enter' && E.draft) { finishDraft(); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && E.sel) { e.preventDefault(); deleteSelection(); return; }
    if (e.key.startsWith('Arrow') && E.sel) {
      const o = getSel();
      if (!o || E.map.layers[TYPE_LAYER[E.sel.type]].locked) return;
      e.preventDefault();
      const step = (e.shiftKey ? 10 : 1) / Math.max(E.zoom, 0.25);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      if (!e.repeat) checkpoint();
      if (o.points) o.points = o.points.map(p => [p[0] + dx, p[1] + dy]); else { o.x += dx; o.y += dy; }
      rerenderType(E.sel.type); markDirty();
      return;
    }
    if (e.key === '+' || e.key === '=') { zoomBy(1.25); return; }
    if (e.key === '-' || e.key === '_') { zoomBy(0.8); return; }
    if (e.key === '0') { fit(); return; }
    if (e.key === '?') { showHelp(); return; }
    if (e.key.toLowerCase() === 'w') { openWiki(); return; }
    if (e.key === '[' || e.key === ']') {
      E.brush.size = Math.max(6, Math.min(300, Math.round(E.brush.size * (e.key === ']' ? 1.15 : 0.87))));
      const sl = $('#inspector [name=bsize]'); if (sl) { sl.value = E.brush.size; sl.dispatchEvent(new Event('input')); }
      return;
    }
    if (e.key.toLowerCase() === 'g') {
      const L = E.map.layers.grid;
      if (E.map.grid.type === 'none') { toast('Pick a grid type in Map settings first.'); return; }
      L.visible = !L.visible; renderLayers(); applyLayerState(); markDirty();
      return;
    }
    const t = TOOLS.find(t => t && t.key.toLowerCase() === e.key.toLowerCase());
    if (t) setTool(t.id);
  });
  document.addEventListener('keyup', e => {
    if (e.key === ' ') { E.spaceDown = false; vp.classList.remove('space'); }
  });
}

// ------------------------------------------------------------------ inspector

function swatches(name, current, { allowDefault = false } = {}) {
  return `<div class="swatches" role="radiogroup">
    ${allowDefault ? `<button type="button" class="sw sw-default ${!current ? 'on' : ''}" data-${name}="" title="Style default"><span></span></button>` : ''}
    ${PALETTE.map(c => `<button type="button" class="sw ${current === c.hex ? 'on' : ''}" data-${name}="${c.hex}" title="${c.name}" style="--c:${c.hex}"><span></span></button>`).join('')}
    <label class="sw sw-custom" title="Custom colour"><input type="color" data-custom="${name}" value="${current || '#3a2c1e'}"><span>${icon('plus')}</span></label>
  </div>`;
}

function seg(name, options, current) {
  return `<div class="seg seg-sm">${Object.entries(options).map(([k, v]) =>
    `<label><input type="radio" name="${name}" value="${k}" ${current === k ? 'checked' : ''}><span>${v}</span></label>`).join('')}</div>`;
}

function slider(name, label, min, max, step, value, fmt = v => v) {
  return `<label class="field field-range"><span>${label}<output>${fmt(value)}</output></span>
    <input type="range" name="${name}" min="${min}" max="${max}" step="${step}" value="${value}"></label>`;
}

function factionField(o) {
  const f = o.factionId && entryMap().get(o.factionId);
  const list = factionList();
  return `
    <label class="field"><span>Faction</span>
      <select name="factionId" data-custom-faction>
        <option value="">None, I choose the colour</option>
        ${list.map(x => `<option value="${x.id}" ${o.factionId === x.id ? 'selected' : ''}>${esc(displayName(x))}</option>`).join('')}
        <option value="__new">New faction…</option>
      </select></label>
    ${f && f.color ? `<p class="insp-hint faction-note"><i style="--c:${f.color}"></i>This territory uses ${esc(displayName(f))}’s colour. Change it in the wiki.</p>`
      : `<p class="field-label">Colour</p>${swatches('color', o.color)}`}`;
}

function secretField(o) {
  return `<label class="check secret-check"><input type="checkbox" name="secret" ${o.secret ? 'checked' : ''}><span><strong>Secret</strong> Only you can see this. It is left out of player exports.</span></label>`;
}

function renderInspector() {
  const box = $('#inspector');
  if (!E.map) { box.innerHTML = ''; return; }
  if (E.tool === 'brush' || E.tool === 'eraser') return renderBrushPanel(box);
  if (E.tool === 'fog') return fogPanel(box);
  if (E.tool === 'party') return partyPanel(box);
  const o = getSel();
  if (!o) return renderMapSettings(box);

  const type = E.sel.type;
  let body = '';
  if (type === 'pin') {
    body = `
      <label class="field"><span>Name</span><input name="name" data-focus value="${esc(nameOf(o, entryMap()))}" placeholder="Name this place"></label>
      <p class="field-label">Symbol</p>
      <div class="glyphs">${Object.entries(PIN_ICONS).map(([k, v]) => `<button type="button" class="glyph ${o.icon === k ? 'on' : ''}" data-icon="${k}" title="${v.name}">${pinGlyph(k)}</button>`).join('')}</div>
      <p class="field-label">Colour</p>${swatches('color', o.color)}
      ${nestFields(o)}
      ${secretField(o)}
      ${wikiFields(o, 'pin')}`;
  } else if (type === 'label') {
    body = `
      <label class="field"><span>Text</span><input name="text" data-focus value="${esc(o.text)}"></label>
      <p class="field-label">Style</p>
      <div class="label-styles">${Object.entries(LABEL_STYLES).map(([k, s]) =>
        `<button type="button" class="ls ${o.style === k ? 'on' : ''}" data-style="${k}" style="font:${s.italic ? 'italic ' : ''}${s.weight} 17px '${s.family}';letter-spacing:${s.spacing * 0.6}em">${s.name}</button>`).join('')}</div>
      ${slider('size', 'Size', 10, 400, 1, o.size)}
      ${slider('rotation', 'Rotation', -90, 90, 1, o.rotation || 0, v => v + '°')}
      <p class="field-label">Colour</p>${swatches('color', o.color, { allowDefault: true })}
      ${secretField(o)}`;
  } else if (type === 'region') {
    body = `
      <label class="field"><span>Name</span><input name="name" data-focus value="${esc(nameOf(o, entryMap()))}" placeholder="The Ashen Reach"></label>
      <label class="check"><input type="checkbox" name="showName" ${o.showName ? 'checked' : ''}><span>Write the name on the map</span></label>
      ${o.showName ? slider('nameSize', 'Name size', 14, 300, 1, o.nameSize || 40) : ''}
      ${factionField(o)}
      ${regionFogHtml()}
      ${slider('fill', 'Fill', 0, 0.6, 0.02, o.fill ?? 0.18, v => Math.round(v * 100) + '%')}
      <p class="field-label">Border</p>${seg('border', { solid: 'Solid', dashed: 'Dashed', none: 'None' }, o.border)}
      <label class="check"><input type="checkbox" name="smooth" ${o.smooth ? 'checked' : ''}><span>Smooth the outline</span></label>
      ${secretField(o)}
      ${wikiFields(o, 'region')}`;
  } else if (type === 'route') {
    const len = polylineLength(o.points);
    const unit = E.map.scale.unit;
    const units = (len / E.map.grid.size) * E.map.scale.perCell;
    const perDay = { mi: 24, km: 38, leagues: 8 }[unit];
    const days = perDay ? units / perDay : null;
    body = `
      <label class="field"><span>Name</span><input name="name" data-focus value="${esc(nameOf(o, entryMap()))}" placeholder="The King's Road"></label>
      <div class="stat-row"><div class="stat"><strong>${formatDistance(len, E.map)}</strong><span>Length</span></div>
      ${days !== null ? `<div class="stat"><strong>${days < 1 ? Math.max(1, Math.round(days * 8)) + ' hr' : (Math.round(days * 2) / 2) + (days >= 1.25 ? ' days' : ' day')}</strong><span>On foot</span></div>` : ''}</div>
      <p class="field-label">Kind</p>${seg('kind', Object.fromEntries(Object.entries(ROUTE_KINDS).map(([k, v]) => [k, v.name])), o.kind)}
      ${slider('width', 'Width', 2, 24, 1, o.width || ROUTE_KINDS[o.kind].width)}
      <p class="field-label">Colour</p>${swatches('color', o.color, { allowDefault: true })}
      <label class="check"><input type="checkbox" name="smooth" ${o.smooth !== false ? 'checked' : ''}><span>Smooth the curve</span></label>
      ${secretField(o)}
      ${wikiFields(o, 'route')}`;
  }

  const locked = E.map.layers[TYPE_LAYER[type]].locked;
  box.innerHTML = `
    <div class="insp-head">
      <span class="insp-kind">${icon(type === 'pin' ? 'pin' : type === 'label' ? 'label' : type === 'region' ? 'region' : 'route')}${TYPE_NAME[type]}</span>
      <button class="ph-btn" data-act="dup" title="Duplicate (Ctrl+D)">${icon('plus')}</button>
      <button class="ph-btn danger" data-act="del" title="Delete (Del)">${icon('trash')}</button>
    </div>
    ${locked ? `<p class="insp-note">${icon('lock')} This layer is locked.</p>` : ''}
    <form class="insp-body" autocomplete="off">${body}</form>
    <p class="insp-tip">${type === 'region' || type === 'route' ? 'Drag the gold points to reshape. Drag a small point to add a bend.' : 'Drag it on the map to move. Arrow keys nudge.'}</p>`;
  bindInspector(box, o, type);
}

function bindInspector(box, o, type) {
  const form = $('form', box);
  $('[data-act=del]', box).onclick = deleteSelection;
  $('[data-act=dup]', box).onclick = duplicateSelection;

  const live = () => { rerenderType(type); markDirty(); };
  const once = () => { if (E.pendingSnap) { pushObjects(E.pendingSnap); E.pendingSnap = null; } };

  form.addEventListener('focusin', () => { E.pendingSnap = snapshot(); });
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('input', e => {
    const t = e.target;
    const n = t.name;
    if (!n || t.type === 'radio' || t.type === 'checkbox' || t.dataset.custom || t.dataset.customFaction !== undefined) return;
    if (type !== 'label' && (n === 'name' || n === 'lore' || n === 'tags')) {
      once();
      if (n === 'name') setName(o, type, t.value);
      else if (n === 'lore' ? setLore(o, type, t.value) : setTags(o, type, t.value)) refreshLinkRow(box, o, type);
      live();
      debouncePlaces();
      return;
    }
    once();
    if (t.type === 'range') {
      o[n] = +t.value;
      const out = t.closest('label').querySelector('output');
      if (out) out.textContent = n === 'fill' ? Math.round(t.value * 100) + '%' : n === 'rotation' ? t.value + '°' : t.value;
    } else o[n] = t.value;
    live();
    if (n === 'text') debouncePlaces();
  });
  form.addEventListener('change', async e => {
    const t = e.target;
    if (t.dataset.customFaction !== undefined) {
      checkpoint();
      if (t.value === '__new') {
        const name = await promptBox('New faction', 'Faction name', '', 'Create');
        if (!name) { renderInspector(); return; }
        o.factionId = newFaction(name).id;
      } else o.factionId = t.value || null;
      live(); renderInspector(); renderPlaces(); renderLegend();
      return;
    }
    if (t.type === 'radio' || t.type === 'checkbox') {
      checkpoint();
      o[t.name] = t.type === 'checkbox' ? t.checked : t.value;
      if (t.name === 'kind') o.width = null;
      live(); renderInspector();
      if (t.name === 'secret') renderPlaces();
    } else if (t.dataset.custom) {
      checkpoint();
      o[t.dataset.custom] = t.value;
      live(); renderInspector(); renderPlaces();
    }
  });
  if (type === 'pin') bindNest(box, o);
  if (type === 'region') bindRegionFog(box, o);
  if (type !== 'label') bindWikiFields(box, o, type, { refresh: () => { rerenderType(type); renderInspector(); renderPlaces(); } });
  $$('[data-color]', box).forEach(b => b.onclick = () => {
    checkpoint(); o.color = b.dataset.color || null; live(); renderInspector(); renderPlaces();
  });
  $$('[data-icon]', box).forEach(b => b.onclick = () => {
    checkpoint(); o.icon = b.dataset.icon; live(); renderInspector(); renderPlaces();
  });
  $$('[data-style]', box).forEach(b => b.onclick = () => {
    checkpoint();
    const prevDefault = LABEL_STYLES[o.style].size;
    o.style = b.dataset.style;
    const k = Math.max(1, E.map.width / 2200);
    if (Math.abs(o.size - Math.round(prevDefault * k)) <= 1) o.size = Math.round(LABEL_STYLES[o.style].size * k);
    live(); renderInspector();
  });
}

let placesTimer = 0;
function debouncePlaces() { clearTimeout(placesTimer); placesTimer = setTimeout(renderPlaces, 250); }

function renderMapSettings(box) {
  const m = E.map;
  const o = m.objects;
  box.innerHTML = `
    <div class="insp-head"><span class="insp-kind">${icon('map')}Map settings</span></div>
    <form class="insp-body" autocomplete="off">
      <label class="field"><span>Map name</span><input name="mapname" value="${esc(m.name)}"></label>
      <div class="stat-row">
        <div class="stat"><strong>${m.width} × ${m.height}</strong><span>Pixels</span></div>
        <div class="stat"><strong>${o.pins.length + o.regions.length + o.routes.length}</strong><span>Places</span></div>
      </div>
      <p class="field-label">Grid</p>
      ${seg('gridtype', { none: 'None', square: 'Square', hex: 'Hex' }, m.grid.type)}
      <div class="grid-opts" ${m.grid.type === 'none' ? 'hidden' : ''}>
        ${slider('gridsize', 'Cell size', 16, 400, 2, m.grid.size, v => v + ' px')}
        ${slider('gridopacity', 'Line strength', 0.05, 0.8, 0.01, m.grid.opacity, v => Math.round(v * 100) + '%')}
      </div>
      <p class="field-label">Scale</p>
      <div class="scale-row">
        <span>One ${m.grid.type === 'hex' ? 'hex' : 'cell'} is</span>
        <input type="number" name="percell" min="0.01" step="any" value="${m.scale.perCell}">
        <select name="unit">${['mi', 'km', 'leagues', 'ft', 'm', 'days'].map(u => `<option ${u === m.scale.unit ? 'selected' : ''}>${u}</option>`).join('')}</select>
      </div>
      <p class="insp-hint">${m.grid.type === 'none' ? 'Distances use an invisible grid. Turn the grid on to see the cell size you are measuring with.' : 'Routes and the measure tool use this scale.'}</p>
      <label class="check"><input type="checkbox" name="pinnames" ${m.showPinNames !== false ? 'checked' : ''}><span>Show pin names on the map</span></label>
      <label class="check"><input type="checkbox" name="legend" ${m.showLegend ? 'checked' : ''}><span>Show a key to the factions on this map</span></label>
    </form>
    <p class="insp-tip">Select anything on the map to edit it here.</p>`;

  const form = $('form', box);
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.name === 'mapname') {
      m.name = t.value.trim() || 'Untitled map';
      renderCrumbs();
      const li = $(`#map-list [data-id="${m.id}"] .mi-open span`); if (li) li.textContent = m.name;
    } else if (t.name === 'gridsize') { m.grid.size = +t.value; t.closest('label').querySelector('output').textContent = t.value + ' px'; renderGrid(); updateScalebar(); }
    else if (t.name === 'gridopacity') { m.grid.opacity = +t.value; t.closest('label').querySelector('output').textContent = Math.round(t.value * 100) + '%'; renderGrid(); }
    else if (t.name === 'percell') { const v = parseFloat(t.value); if (v > 0) { m.scale.perCell = v; updateScalebar(); } }
    else return;
    markDirty();
  });
  form.addEventListener('change', e => {
    const t = e.target;
    if (t.name === 'gridtype') {
      m.grid.type = t.value;
      if (t.value !== 'none') m.layers.grid.visible = true;
      renderGrid(); renderLayers(); applyLayerState(); renderMapSettings(box);
    } else if (t.name === 'unit') { m.scale.unit = t.value; updateScalebar(); }
    else if (t.name === 'pinnames') { m.showPinNames = t.checked; renderPins(); }
    else if (t.name === 'legend') { m.showLegend = t.checked; renderLegend(); }
    else return;
    markDirty();
  });
}

function stampPreview(kind) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 48;
  const ctx = c.getContext('2d');
  let seed = 3;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  if (kind === 'ink') {
    ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(8, 32); ctx.bezierCurveTo(20, 10, 34, 42, 56, 16); ctx.stroke();
  } else if (kind === 'waves') { drawStamp(ctx, kind, 26, 26, 30, 1, rnd); drawStamp(ctx, kind, 42, 38, 26, 1, rnd); }
  else {
    const n = kind === 'mountains' || kind === 'hills' ? 2 : 3;
    for (let i = 0; i < n; i++) drawStamp(ctx, kind, 18 + i * (46 / n) + (n === 2 ? 6 : 0), 42 - (i % 2) * 4, kind === 'mountains' ? 30 : 26, 1, rnd);
  }
  return c.toDataURL();
}
const stampPreviews = {};

function renderBrushPanel(box) {
  const b = E.brush;
  const erasing = E.tool === 'eraser';
  for (const k of Object.keys(STAMPS)) stampPreviews[k] ??= stampPreview(k);
  box.innerHTML = `
    <div class="insp-head"><span class="insp-kind">${icon(erasing ? 'eraser' : 'brush')}${erasing ? 'Terrain eraser' : 'Terrain brush'}</span></div>
    <form class="insp-body" autocomplete="off">
      ${erasing ? '' : `
      <p class="field-label">Paint land and sea</p>
      <div class="paints">${Object.entries(PAINTS).map(([k, p]) =>
        `<button type="button" class="paint ${b.mode === 'paint' && b.paint === k ? 'on' : ''}" data-paint="${k}" style="--c:${p.color}"><span class="paint-chip"></span><span>${p.name}</span></button>`).join('')}</div>
      <p class="field-label">Draw features</p>
      <div class="stamps">${Object.entries(STAMPS).map(([k, s]) =>
        `<button type="button" class="stamp ${b.mode === 'stamp' && b.stamp === k ? 'on' : ''}" data-stamp="${k}"><img src="${stampPreviews[k]}" alt=""><span>${s.name}</span></button>`).join('')}</div>`}
      ${slider('bsize', 'Size', 6, 300, 1, b.size, v => v + ' px')}
      ${slider('bstrength', erasing ? 'Strength' : 'Strength', 0.05, 1, 0.05, b.strength, v => Math.round(v * 100) + '%')}
      ${!erasing && b.mode === 'stamp' && b.stamp !== 'ink' ? slider('bspacing', 'Spacing', 0.5, 2.5, 0.1, b.spacing, v => (+v).toFixed(1) + '×') : ''}
    </form>
    <p class="insp-tip">${erasing ? 'Erasing only touches terrain paint. Pins, labels and your base image stay put.' : 'Lay down colour first, then stamp mountains and forests on top. Size follows your screen, so zoom in for fine detail. <kbd>[</kbd> and <kbd>]</kbd> change it.'}</p>
    <div class="insp-foot">${erasing ? '' : `<button class="btn btn-sm" id="btn-coast" title="Ink a coastline wherever sea paint meets land">${icon('wave')}Outline coasts</button>`}<button class="btn btn-sm btn-danger-ghost" id="btn-clear-terrain">${icon('trash')}Clear terrain</button></div>`;

  $$('[data-paint]', box).forEach(x => x.onclick = () => { b.mode = 'paint'; b.paint = x.dataset.paint; renderBrushPanel(box); });
  $$('[data-stamp]', box).forEach(x => x.onclick = () => {
    if (b.mode !== 'stamp') b.strength = 1;
    b.mode = 'stamp'; b.stamp = x.dataset.stamp; renderBrushPanel(box);
  });
  $('form', box).addEventListener('input', e => {
    const t = e.target, out = t.closest('label')?.querySelector('output');
    if (t.name === 'bsize') { b.size = +t.value; if (out) out.textContent = t.value + ' px'; }
    if (t.name === 'bstrength') { b.strength = +t.value; if (out) out.textContent = Math.round(t.value * 100) + '%'; }
    if (t.name === 'bspacing') { b.spacing = +t.value; if (out) out.textContent = (+t.value).toFixed(1) + '×'; }
  });
  $('#btn-clear-terrain').onclick = clearTerrain;
  $('#btn-coast')?.addEventListener('click', outlineCoasts);
}

// ------------------------------------------------------------------ help

function showHelp() {
  const rows = [
    ['Tools', [['V', 'Select and move'], ['H', 'Pan'], ['P', 'Pin'], ['T', 'Label'], ['R', 'Region'], ['L', 'Route'], ['B', 'Terrain brush'], ['E', 'Eraser'], ['M', 'Measure'], ['F', 'Fog of war'], ['K', 'Party and travel']]],
    ['Map', [['Space + drag', 'Pan from any tool'], ['Scroll', 'Zoom'], ['0', 'Fit map'], ['+ / −', 'Zoom in or out'], ['G', 'Show or hide grid'], ['[ / ]', 'Brush size']]],
    ['Editing', [['Ctrl + Z', 'Undo'], ['Ctrl + Shift + Z', 'Redo'], ['Ctrl + D', 'Duplicate'], ['Alt + drag', 'Duplicate and move'], ['Arrows', 'Nudge (Shift for more)'], ['Delete', 'Delete selection'], ['Enter', 'Finish region or route'], ['Right-click', 'Remove last point'], ['Esc', 'Cancel or deselect'], ['Ctrl + S', 'Save now']]],
    ['Wiki', [['W', 'Open the wiki'], ['||text||', 'Mark text as GM-only inside notes'], ['Ctrl + K', 'Find any entry, place or map'], ['[[', 'Link to an entry while writing'], ['Esc', 'Back to the map']]],
  ];
  dialog({
    title: 'Keyboard shortcuts', wide: 'xl',
    body: `<div class="keys">${rows.map(([h, list]) => `<div><p class="field-label">${h}</p><dl>${list.map(([k, v]) => `<dt>${k.split(' ').map(x => x === '+' || x === '/' ? x : `<kbd>${x}</kbd>`).join(' ')}</dt><dd>${v}</dd>`).join('')}</dl></div>`).join('')}</div>`,
    buttons: [{ label: 'Close', value: true, primary: true }],
  });
}

// ------------------------------------------------------------------ export

async function renderToBlob(opts, maxSide = 8192) {
  const m = E.map;
  const scale = Math.min(1, maxSide / Math.max(m.width, m.height));
  const c = document.createElement('canvas');
  c.width = Math.round(m.width * scale); c.height = Math.round(m.height * scale);
  renderMap(c.getContext('2d'), m, { base: E.baseSource, terrain: terrainCanvas }, { scale, pinScale: Math.max(1, m.width / 1600), entries: entryMap(), ...opts });
  return new Promise(r => c.toBlob(r, 'image/png'));
}

const secretCount = m => Object.values(m.objects).reduce((n, list) => n + list.filter(x => isSecret(x, entryMap())).length, 0);

/** Canvas text only loads a font when it is first used, so load every lettering style up front. */
async function ensureFonts() {
  const sample = 'Aa Ææ Éé';
  await Promise.all(Object.keys(LABEL_STYLES).map(k => document.fonts.load(labelFont(k, 24), sample).catch(() => {})));
  await document.fonts.ready;
}

async function doExport(kind) {
  await flush();
  await flushEntries();
  try {
    if (kind === 'world') {
      const blob = await exportWorld(E.world.id);
      download(blob, safeName(E.world.name) + '.mapfold');
      toast('World exported', 'good');
    } else if (kind === 'png' || kind === 'png-gm') {
      await ensureFonts();
      const players = kind === 'png';
      const wp = E.world.party;
      const blob = await renderToBlob(players ? { hideSecret: true, fog: fogCanvas(), party: wp && wp.mapId === E.map.id && wp.visible !== false ? wp : null } : { hideSecret: false });
      download(blob, `${safeName(E.world.name)}-${safeName(E.map.name)}${players ? '' : '-gm'}.png`);
      const hidden = players ? secretCount(E.map) : 0;
      toast(hidden ? `Map image saved. ${hidden} secret ${hidden === 1 ? 'item was' : 'items were'} left out.` : 'Map image saved', 'good', hidden ? 4200 : 2800);
    } else if (kind === 'inkfold') {
      await ensureFonts();
      const plain = await renderToBlob({ only: ['base', 'terrain'] });
      const full = await renderToBlob({ hideSecret: true });
      const json = interchangeFor(E.map, E.world, entryMap());
      const zip = await makeZip([
        { name: 'interchange.json', data: JSON.stringify(json, null, 1) },
        { name: 'map.png', data: plain },
        { name: 'rendered.png', data: full },
      ]);
      download(zip, `${safeName(E.map.name)}.inkfold-map.zip`);
      toast('Inkfold map exported', 'good');
    }
  } catch (err) {
    console.error(err);
    toast('Export failed: ' + (err.message || 'unknown error'), 'bad', 5000);
  }
}
