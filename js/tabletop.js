// Mapfold — at the table: fog of war, the party token and travel, and the player window. Author: direk james
//
// The player window never reads the database. Every few moments this window draws a player-safe picture of
// the map (secrets, secret factions and fogged areas already painted out) and sends only that picture.
import { db } from './db.js';
import { $, $$, esc, toast, dialog, confirmBox } from './ui.js';
import { icon } from './icons.js';
import { renderMap } from './render.js';
import { displayName, nameOf } from './entries.js';
import { formatDay, isDay } from './calendar.js';
import { createEntry, touchEntry, entryMap, calendar, openWiki } from './wiki.js';
import { newFog, loadFog, fogDab, fogPolygon, fogFill, fogSize, PACES, DEFAULT_SPEED, pxToUnits, routeBetween, travelDays } from './table.js';

let H = null;
const NS = 'http://www.w3.org/2000/svg';
const T = {
  fog: null, stroke: null,
  fogMode: 'reveal', fogSize: 90, fogSoft: 0.35,
  see: 'whole', blackout: false,
  channel: null, playersOpen: false, win: null,
  pushTimer: 0, pushing: false, pushAgain: false, lastPush: 0, viewTimer: 0,
  partyG: null,
};

export const fogOn = () => !!(H.map()?.fog?.on && T.fog);

export function initTabletop(host) {
  H = host;
  T.partyG = document.createElementNS(NS, 'g');
  T.partyG.id = 'g-party';
  $('#g-pins').after(T.partyG);
  initPlayers();
}

// ------------------------------------------------------------------ fog

/** Called whenever a map opens: shows its fog, or none. */
export async function attachFog(map, blob) {
  T.fog?.remove();
  T.fog = null; T.stroke = null;
  if (map.fog?.on) {
    T.fog = await loadFog(map, blob);
    T.fog.id = 'fog-canvas';
    T.fog.style.width = map.width + 'px';
    T.fog.style.height = map.height + 'px';
    $('#overlay').after(T.fog);
    T.fog.classList.toggle('editing', H.tool() === 'fog');
  }
  renderParty();
  changed();
}

export function fogBlob() { return T.fog ? new Promise(r => T.fog.toBlob(r, 'image/png')) : Promise.resolve(null); }
export const fogCanvas = () => (fogOn() ? T.fog : null);
export const fogBrushPx = () => T.fogSize;

export function toolChanged(tool) { T.fog?.classList.toggle('editing', tool === 'fog'); }

function snap() { const c = T.fog; return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height); }

function commitFog(before) {
  const c = T.fog;
  H.history({ kind: 'fog', before, after: snap() });
  H.markFogDirty();
  changed();
}

export function applyFogHistory(h, isUndo) {
  if (!T.fog) return;
  T.fog.getContext('2d').putImageData(isUndo ? h.before : h.after, 0, 0);
  H.markFogDirty();
  changed();
}

function fogBrush(m) {
  const map = H.map(), { s } = fogSize(map);
  const ctx = T.fog.getContext('2d');
  const r = (T.fogSize / H.zoom()) * s / 2;
  const st = T.stroke;
  const spacing = Math.max(1, r * 0.25);
  if (!st.last) { fogDab(ctx, m[0] * s, m[1] * s, r, T.fogMode === 'reveal', T.fogSoft); st.last = m; return; }
  const dx = (m[0] - st.last[0]) * s, dy = (m[1] - st.last[1]) * s, d = Math.hypot(dx, dy);
  const n = Math.max(1, Math.floor(d / spacing));
  for (let i = 1; i <= n; i++) fogDab(ctx, st.last[0] * s + dx * i / n, st.last[1] * s + dy * i / n, r, T.fogMode === 'reveal', T.fogSoft);
  st.last = m;
}

/** Pointer handling for the fog tool and the party tool. Returns true when it used the event. */
export function pointerDown(tool, m) {
  if (tool === 'fog') {
    if (!T.fog) { toast('Cover this map in fog first, using the button on the right.'); return true; }
    T.stroke = { before: snap(), last: null };
    fogBrush(m);
    return true;
  }
  if (tool === 'party') { partyClick(m); return true; }
  return false;
}
export function pointerMove(m) { if (T.stroke) { fogBrush(m); changed(); } }
export function pointerUp() {
  if (!T.stroke) return false;
  const before = T.stroke.before; T.stroke = null;
  commitFog(before);
  return true;
}
export const strokeActive = () => !!T.stroke;

function setFog(on, covered = true) {
  const map = H.map();
  if (on) {
    map.fog = { on: true };
    T.fog?.remove();
    T.fog = newFog(map, covered);
    T.fog.id = 'fog-canvas';
    T.fog.style.width = map.width + 'px'; T.fog.style.height = map.height + 'px';
    $('#overlay').after(T.fog);
    T.fog.classList.toggle('editing', H.tool() === 'fog');
  } else {
    map.fog = { on: false };
    T.fog?.remove(); T.fog = null;
  }
  H.markDirty(); H.markFogDirty();
  changed();
}

/** Inspector for the fog tool. */
export function fogPanel(box) {
  const map = H.map();
  if (!map.fog?.on) {
    box.innerHTML = `
      <div class="insp-head"><span class="insp-kind">${icon('cloud')}Fog of war</span></div>
      <div class="insp-body">
        <p class="insp-hint">Hide the map from your players, then reveal it as they explore. Each map has its own fog. You always see through it, dimmed.</p>
        <button class="btn btn-gilt" id="fog-on">${icon('cloud')}Cover this map in fog</button>
      </div>`;
    $('#fog-on', box).onclick = () => { setFog(true, true); H.refreshInspector(); toast('The map is covered. Paint to reveal areas.'); };
    return;
  }
  box.innerHTML = `
    <div class="insp-head"><span class="insp-kind">${icon('cloud')}Fog of war</span></div>
    <form class="insp-body" autocomplete="off">
      <div class="seg seg-sm fog-mode">
        <label><input type="radio" name="fogmode" value="reveal" ${T.fogMode === 'reveal' ? 'checked' : ''}><span>Reveal</span></label>
        <label><input type="radio" name="fogmode" value="cover" ${T.fogMode === 'cover' ? 'checked' : ''}><span>Cover</span></label>
      </div>
      <label class="field field-range"><span>Brush size<output>${T.fogSize} px</output></span><input type="range" name="fogsize" min="10" max="400" step="1" value="${T.fogSize}"></label>
      <label class="field field-range"><span>Soft edge<output>${Math.round(T.fogSoft * 100)}%</output></span><input type="range" name="fogsoft" min="0" max="0.9" step="0.05" value="${T.fogSoft}"></label>
      <p class="insp-hint">Paint on the map. Select a region with the Select tool to reveal it in one click.</p>
    </form>
    <div class="insp-foot">
      <button class="btn btn-sm" id="fog-all">Reveal everything</button>
      <button class="btn btn-sm" id="fog-none">Cover everything</button>
      <button class="btn btn-sm btn-danger-ghost" id="fog-off">${icon('trash')}Turn fog off</button>
    </div>`;
  const form = $('form', box);
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('input', e => {
    const t = e.target, out = t.closest('label')?.querySelector('output');
    if (t.name === 'fogmode') T.fogMode = t.value;
    if (t.name === 'fogsize') { T.fogSize = +t.value; if (out) out.textContent = t.value + ' px'; }
    if (t.name === 'fogsoft') { T.fogSoft = +t.value; if (out) out.textContent = Math.round(t.value * 100) + '%'; }
  });
  const whole = covered => { const b = snap(); fogFill(T.fog.getContext('2d'), T.fog.width, T.fog.height, covered); commitFog(b); };
  $('#fog-all', box).onclick = () => { whole(false); toast('Everything is revealed. Undo with Ctrl+Z.'); };
  $('#fog-none', box).onclick = async () => {
    if (await confirmBox('Cover the whole map again?', 'Everything your players have uncovered here will be hidden. You can undo this with Ctrl+Z.', { okLabel: 'Cover it' })) whole(true);
  };
  $('#fog-off', box).onclick = async () => {
    if (await confirmBox('Turn fog off for this map?', 'Players will see the whole map. The fog you painted is thrown away.', { okLabel: 'Turn fog off' })) { setFog(false); H.refreshInspector(); }
  };
}

/** Buttons shown in a region's inspector while this map has fog. */
export function regionFogHtml() {
  return H.map().fog?.on && T.fog ? `
    <p class="field-label">Fog of war</p>
    <div class="fog-reg"><button type="button" class="btn btn-sm" data-fogreg="reveal">${icon('eye')}Reveal to players</button><button type="button" class="btn btn-sm" data-fogreg="cover">Cover again</button></div>` : '';
}
export function bindRegionFog(box, region) {
  $$('[data-fogreg]', box).forEach(b => b.onclick = () => {
    if (!T.fog) return;
    const before = snap(), { s } = fogSize(H.map());
    fogPolygon(T.fog.getContext('2d'), region.points, s, b.dataset.fogreg === 'reveal');
    commitFog(before);
    toast(b.dataset.fogreg === 'reveal' ? 'Region revealed. Undo with Ctrl+Z.' : 'Region covered again.');
  });
}

// ------------------------------------------------------------------ party and travel

const world = () => H.world();
const party = () => world().party || null;

export function renderParty() {
  const g = T.partyG; if (!g) return;
  g.innerHTML = '';
  const p = party(), map = H.map();
  if (!p || !map || p.mapId !== map.id) return;
  const k = Math.max(1, map.width / 1600);
  g.innerHTML = `<g class="party-token" transform="translate(${p.x} ${p.y})" style="pointer-events:none">
    <circle r="${15 * k}" fill="#c8a15a" stroke="#2a1d10" stroke-width="${3 * k}"/>
    <path d="M${-4 * k} ${8 * k}V${-8 * k}L${8 * k} ${-3.5 * k}L${-4 * k} ${k}" fill="#2a1d10"/>
  </g>`;
}

function partyInfo() {
  const p = party();
  return p ? { ...p, mapName: H.maps().find(m => m.id === p.mapId)?.name || 'another map' } : null;
}

async function saveWorld() {
  world().updated = Date.now();
  try { await db.putWorld(world()); } catch (err) { console.error(err); toast('Saving failed. Your browser may be out of storage space.', 'bad', 6000); }
}

function nearPlaceIds(map, pt) {
  const reach = 28 * Math.max(1, map.width / 1600);
  return map.objects.pins.filter(p => p.entryId && Math.hypot(p.x - pt[0], p.y - pt[1]) <= reach).map(p => p.entryId);
}
function nearName(map, pt, fallback) {
  const reach = 28 * Math.max(1, map.width / 1600);
  const pin = map.objects.pins.find(p => nameOf(p, entryMap()) && Math.hypot(p.x - pt[0], p.y - pt[1]) <= reach);
  return pin ? nameOf(pin, entryMap()) : fallback;
}

async function partyClick(m) {
  const map = H.map(), w = world();
  if (m[0] < 0 || m[1] < 0 || m[0] > map.width || m[1] > map.height) return;
  const unit = map.scale.unit;
  if (!w.party) {
    w.party = { mapId: map.id, x: m[0], y: m[1], name: 'The party', pace: 'normal', speed: DEFAULT_SPEED[unit] || 24, visible: true };
    await saveWorld(); renderParty(); H.refreshInspector(); changed();
    toast('Party placed. Click elsewhere on the map to travel.');
    return;
  }
  const p = w.party;
  if (p.mapId !== map.id) {
    p.mapId = map.id; p.x = m[0]; p.y = m[1];
    await saveWorld(); renderParty(); H.refreshInspector(); changed();
    toast(`The party arrives on ${map.name}.`);
    return;
  }
  const reach = 22 * Math.max(1, map.width / 1600) / Math.max(0.5, Math.min(H.zoom(), 2));
  const leg = routeBetween(map.objects.routes, [p.x, p.y], m, reach);
  const dest = leg ? leg.to : m;
  const px = leg ? leg.px : Math.hypot(dest[0] - p.x, dest[1] - p.y);
  const units = pxToUnits(px, map);
  if (units <= 0) return;
  const fromName = nearName(map, [p.x, p.y], 'where they stood'), toName = nearName(map, dest, 'the wilds');
  const routeName = leg ? (nameOf(leg.route, entryMap()) || 'the road') : '';
  const unitTxt = u => `${Math.round(u * 10) / 10} ${unit}`;
  const speed = Math.max(0.01, +p.speed || DEFAULT_SPEED[unit] || 24);
  const lines = key => { const d = travelDays(units, speed, key); return `${d} ${d === 1 ? 'day' : 'days'}`; };
  const { value, form } = await dialog({
    title: 'Travel',
    body: `
      <p class="dlg-text"><strong>${esc(fromName)}</strong> to <strong>${esc(toName)}</strong><br>
      ${esc(unitTxt(units))} ${leg ? `along ${esc(routeName)}` : 'overland, in a straight line'}</p>
      <p class="field-label">Pace</p>
      <div class="seg seg-sm trip-pace">${Object.entries(PACES).map(([k, v]) => `<label title="${esc(v.note)}"><input type="radio" name="pace" value="${k}" ${p.pace === k ? 'checked' : ''}><span>${v.name}</span></label>`).join('')}</div>
      <p class="trip-days"><strong id="trip-n">${lines(p.pace)}</strong> <span>at ${speed} ${esc(unit)} a day</span></p>`,
    buttons: [{ label: 'Cancel', value: null }, { label: 'Just move the token', value: 'move' }, { label: 'Travel', value: 'go', primary: true }],
    onOpen: f => f.addEventListener('change', e => { if (e.target.name === 'pace') $('#trip-n', f).textContent = lines(e.target.value); }),
  });
  if (!value) return;
  const pace = form.querySelector('[name=pace]:checked')?.value || p.pace;
  const start = isDay(w.currentDay) ? w.currentDay : 0;
  const from = [p.x, p.y];
  p.pace = pace; p.x = dest[0]; p.y = dest[1];
  if (value === 'go') {
    const days = travelDays(units, speed, pace);
    w.currentDay = start + days;
    const ev = createEntry('event', `Travel: ${fromName} to ${toName}`);
    ev.day = start; ev.endDay = days > 0 ? start + days : null;
    ev.tags = ['travel'];
    ev.placeIds = [...new Set([...nearPlaceIds(map, from), ...nearPlaceIds(map, dest)])];
    ev.body = `The party travelled ${unitTxt(units)} ${leg ? `along ${routeName}` : 'overland'} at a ${PACES[pace].name.toLowerCase()} pace, ${days} ${days === 1 ? 'day' : 'days'}.`;
    touchEntry(ev);
    toast(`${days} ${days === 1 ? 'day passes' : 'days pass'}. It is now ${formatDay(w.currentDay, calendar())}.`, 'good', 4200);
  }
  await saveWorld(); renderParty(); H.refreshInspector(); changed();
}

export function partyPanel(box) {
  const map = H.map(), p = partyInfo(), unit = map.scale.unit, cal = calendar(), w = world();
  if (!p) {
    box.innerHTML = `
      <div class="insp-head"><span class="insp-kind">${icon('flag')}Party</span></div>
      <div class="insp-body"><p class="insp-hint">Click the map to place your party's token. Then click again anywhere to travel: along a road, trail or river if you click near one, or overland if not. Days pass on your calendar and each trip is written to the timeline.</p></div>`;
    return;
  }
  const trips = [...entryMap().values()].filter(e => e.type === 'event' && (e.tags || []).includes('travel') && isDay(e.day)).sort((a, b) => b.day - a.day).slice(0, 6);
  box.innerHTML = `
    <div class="insp-head"><span class="insp-kind">${icon('flag')}Party</span><button class="ph-btn danger" id="party-rm" title="Remove the token">${icon('trash')}</button></div>
    <form class="insp-body" autocomplete="off">
      <label class="field"><span>Name</span><input name="pname" value="${esc(p.name)}" maxlength="60"></label>
      <p class="field-label">Pace</p>
      <div class="seg seg-sm">${Object.entries(PACES).map(([k, v]) => `<label title="${esc(v.note)}"><input type="radio" name="ppace" value="${k}" ${p.pace === k ? 'checked' : ''}><span>${v.name}</span></label>`).join('')}</div>
      <label class="field"><span>Distance per day at a normal pace (${esc(unit)})</span><input type="number" name="pspeed" min="0.01" step="any" value="${p.speed}"></label>
      <label class="check"><input type="checkbox" name="pvisible" ${p.visible !== false ? 'checked' : ''}><span>Show the token to players</span></label>
      <div class="stat-row"><div class="stat"><strong>${esc(p.mapName)}</strong><span>Is on</span></div>
        <div class="stat"><strong>${isDay(w.currentDay) ? esc(formatDay(w.currentDay, cal)) : 'Not set'}</strong><span>Today</span></div></div>
      <p class="insp-hint">Click the map to travel. ${p.mapId === map.id ? '' : 'Click here to bring the party to this map.'}</p>
      ${trips.length ? `<p class="field-label">Recent journeys</p><div class="trips">${trips.map(e => `<button type="button" class="trip" data-trip="${e.id}"><strong>${esc(displayName(e))}</strong><small>${esc(formatDay(e.day, cal))}</small></button>`).join('')}</div>` : ''}
    </form>`;
  const form = $('form', box);
  form.addEventListener('submit', e => e.preventDefault());
  form.addEventListener('input', e => {
    const t = e.target;
    if (t.name === 'pname') p.name = world().party.name = t.value.slice(0, 60);
    else if (t.name === 'pspeed') { const v = parseFloat(t.value); if (v > 0) world().party.speed = v; }
    else return;
    saveWorld();
  });
  form.addEventListener('change', e => {
    const t = e.target, wp = world().party;
    if (t.name === 'ppace') wp.pace = t.value;
    else if (t.name === 'pvisible') wp.visible = t.checked;
    else return;
    saveWorld(); changed();
  });
  $('#party-rm', box).onclick = async () => {
    if (await confirmBox('Remove the party token?', 'The token leaves the map. Your timeline of journeys stays.', { okLabel: 'Remove' })) {
      delete world().party; await saveWorld(); renderParty(); H.refreshInspector(); changed();
    }
  };
  $$('[data-trip]', box).forEach(b => b.onclick = () => openWiki(b.dataset.trip));
}

// ------------------------------------------------------------------ player window

const CH = 'mapfold-player';

function initPlayers() {
  const wrap = $('#btn-players')?.closest('.menu-wrap');
  if (!wrap) return;
  const menu = $('#menu-players');
  const paint = () => {
    menu.innerHTML = `
      <button type="button" data-pl="open"><strong>${T.playersOpen ? 'Bring the player window forward' : 'Open the player window'}</strong><span>Drag it to your TV or projector and press F for fullscreen</span></button>
      <div class="menu-sep"></div>
      <p class="menu-label">Players see</p>
      <button type="button" data-pl="whole" class="${T.see === 'whole' ? 'on' : ''}"><strong>The whole map</strong><span>Fits their screen</span></button>
      <button type="button" data-pl="follow" class="${T.see === 'follow' ? 'on' : ''}"><strong>What I am looking at</strong><span>Follows your pan and zoom</span></button>
      <div class="menu-sep"></div>
      <button type="button" data-pl="blackout" class="${T.blackout ? 'on' : ''}"><strong>${T.blackout ? 'Show the map again' : 'Black out the screen'}</strong><span>Hide everything while you set up</span></button>`;
  };
  paint();
  $('#btn-players').onclick = e => { e.stopPropagation(); paint(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap')) menu.hidden = true; });
  menu.addEventListener('click', e => {
    const b = e.target.closest('[data-pl]'); if (!b) return;
    const a = b.dataset.pl;
    menu.hidden = true;
    if (a === 'open') { openPlayers(); return; }
    if (a === 'whole' || a === 'follow') { T.see = a; sendView(true); }
    if (a === 'blackout') { T.blackout = !T.blackout; post({ t: 'blackout', on: T.blackout }); }
    paint();
    $('#btn-players').classList.toggle('on', T.blackout || T.see === 'follow');
  });
  try {
    T.channel = new BroadcastChannel(CH);
    T.channel.onmessage = ev => {
      const m = ev.data || {};
      if (m.t === 'hello') { T.playersOpen = true; changed(true); sendView(true); post({ t: 'blackout', on: T.blackout }); paint(); }
      else if (m.t === 'bye') { T.playersOpen = false; paint(); }
    };
  } catch { $('#btn-players').hidden = true; }
}

function post(msg) { try { T.channel?.postMessage(msg); } catch (err) { console.error(err); } }

export function openPlayers() {
  const w = window.open('player.html', 'mapfold-player', 'popup,width=1280,height=800');
  if (!w) { toast('Your browser blocked the window. Allow pop-ups for this site and try again.', 'bad', 5000); return; }
  T.win = w; w.focus?.();
}

/** The map changed in a way players might see: send a fresh picture soon. */
export function changed(now = false) {
  if (!T.playersOpen || !T.channel) return;
  clearTimeout(T.pushTimer);
  const wait = now ? 0 : Math.max(120, 320 - (Date.now() - T.lastPush));
  T.pushTimer = setTimeout(pushFrame, wait);
}

async function pushFrame() {
  const map = H.map();
  if (!map) { post({ t: 'idle' }); return; }
  if (T.pushing) { T.pushAgain = true; return; }
  T.pushing = true;
  try {
    const W = map.width, Hh = map.height, k = Math.min(1, 2600 / Math.max(W, Hh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(Hh * k));
    const p = party();
    renderMap(c.getContext('2d'), map, H.sources(), {
      scale: k, pinScale: Math.max(1, W / 1600), entries: entryMap(), hideSecret: true,
      fog: fogOn() ? T.fog : null, party: p && p.mapId === map.id && p.visible !== false ? p : null,
    });
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    c.width = c.height = 0;
    if (blob) post({ t: 'frame', blob, w: W, h: Hh, name: map.name, id: map.id });
    T.lastPush = Date.now();
  } catch (err) { console.error(err); }
  T.pushing = false;
  if (T.pushAgain) { T.pushAgain = false; changed(); }
}

/** Where the GM is looking, so the player window can follow. */
export function viewChanged() {
  if (!T.playersOpen || T.see !== 'follow') return;
  clearTimeout(T.viewTimer);
  T.viewTimer = setTimeout(() => sendView(), 60);
}
function sendView(force = false) {
  if (!T.playersOpen && !force) return;
  post({ t: 'view', rect: T.see === 'follow' && H.map() ? H.viewRect() : null });
}

export function sessionEnded() { post({ t: 'idle' }); }
