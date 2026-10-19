// Mapfold — maps inside maps. Pure helpers: no DOM, no storage. Author: direk james
//
// A pin may open another map (pin.childMapId); that map remembers its home (map.parentMapId).
// Breadcrumbs follow parentMapId, so a map reached from several pins still has one trail.

/** Maps from the root down to and including `map`. Safe against loops in damaged data. */
export function trail(map, byId) {
  const out = [];
  const seen = new Set();
  for (let m = map; m && !seen.has(m.id); m = byId.get(m.parentMapId)) { seen.add(m.id); out.unshift(m); }
  return out;
}

/** Maps in outline order (children under parents) with their depth. */
export function outline(maps) {
  const byId = new Map(maps.map(m => [m.id, m]));
  const kids = new Map();
  const roots = [];
  for (const m of maps) {
    const p = m.parentMapId && byId.has(m.parentMapId) && m.parentMapId !== m.id ? m.parentMapId : null;
    if (p) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(m); } else roots.push(m);
  }
  const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || (a.name || '').localeCompare(b.name || '');
  const out = [];
  const seen = new Set();
  const walk = (m, depth) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    out.push({ map: m, depth });
    (kids.get(m.id) || []).sort(byOrder).forEach(c => walk(c, depth + 1));
  };
  roots.sort(byOrder).forEach(m => walk(m, 0));
  // anything caught in a loop of damaged data still shows up
  maps.filter(m => !seen.has(m.id)).sort(byOrder).forEach(m => walk(m, 0));
  return out;
}

/** Maps a pin on `current` may open: not itself, and none of its own ancestors (that would make a loop). */
export function nestable(current, maps) {
  const byId = new Map(maps.map(m => [m.id, m]));
  const banned = new Set(trail(current, byId).map(m => m.id));
  return maps.filter(m => !banned.has(m.id));
}
