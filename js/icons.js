// Mapfold — icon sets. Author: direk james
// UI icons and pin glyphs are 24x24 stroke paths so the same data
// renders in SVG (editor) and on canvas via Path2D (exports).

export const UI_ICONS = {
  select: 'M6 3l12 9-5.5 1L15 19l-2.5 1.2-2.6-6L6 17z',
  pan: 'M8 12V6.5a1.5 1.5 0 0 1 3 0V11M11 10.5V5a1.5 1.5 0 0 1 3 0v6M14 10V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7-2.5 0-4-1-5.5-3L3.8 14.6a1.5 1.5 0 0 1 2.4-1.8L8 15',
  pin: 'M12 21s-6.5-6-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 15 12 21 12 21zM12 7.3a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
  label: 'M5 6V4h14v2M12 4v16M9 20h6',
  region: 'M4 8l6-4 9 3 1 8-6 5-9-3zM4 8v0',
  route: 'M4 19c3 0 3-5 6-5s3 3 6 3 2-7 4-11M4 19h.01M20 6h.01',
  measure: 'M3 16.5L16.5 3 21 7.5 7.5 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  brush: 'M18.5 3.5a2.1 2.1 0 0 1 3 3L12 16l-3-3zM9 13c-2.5 0-4.5 1.8-4.5 4.5 0 1-.6 2-1.5 2.5 1 .7 2.3 1 3.5 1 3.4 0 5-2 5-4.5',
  eraser: 'M8 20l-4.5-4.5a1.5 1.5 0 0 1 0-2.1L13 4l7 7-9 9zM9 9l6 6M8 20h12',
  undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.3-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 0 1 6.8-1.2',
  trash: 'M4 7h16M10 11v6M14 11v6M5.5 7l1 13h11l1-13M9 7V4h6v3',
  export: 'M12 15V3M7 8l5-5 5 5M4 15v5h16v-5',
  import: 'M12 3v12M7 10l5 5 5-5M4 15v5h16v-5',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5L20 20',
  book: 'M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5C4.7 20 4 19.3 4 18.5zM20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5zM6.5 8h2M15.5 8h2',
  close: 'M6 6l12 12M18 6L6 18',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.7M12 17h.01',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  grid: 'M4 4h16v16H4zM4 9.3h16M4 14.7h16M9.3 4v16M14.7 4v16',
  terrain: 'M2 19l6-9 4 5 3-4 7 8z',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  image: 'M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15.5 9a1.5 1.5 0 1 0 0 .01',
  scroll: 'M7 4h11a2 2 0 0 1 2 2v1h-4M7 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7M7 4a2 2 0 0 1 2 2v14M11 10h5M11 14h5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  chevron: 'M9 6l6 6-6 6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20.5c.8-3.7 3.8-5.5 7.5-5.5s6.7 1.8 7.5 5.5',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  gem: 'M6 4h12l3.5 5L12 21 2.5 9zM2.5 9h19M9 4L7 9l5 12 5-12-2-5',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  unlink: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1M4 4l16 16',
  wiki: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h10M9 8h5',
};

export const PIN_ICONS = {
  marker:   { name: 'Marker',    d: 'M12 20s-5-5-5-9.5a5 5 0 0 1 10 0C17 15 12 20 12 20zM12 9.5v.5' },
  city:     { name: 'City',      d: 'M4 20V11l3-2 3 2v9M10 20V7l4-3 4 3v13M3 20h18M13 10h2M13 14h2' },
  town:     { name: 'Town',      d: 'M4 20v-8l8-6.5 8 6.5v8zM10 20v-5h4v5' },
  castle:   { name: 'Castle',    d: 'M4 20V7h2.5v2.5H9V7h2v2.5h2V7h2v2.5h2.5V7H20v13zM10 20v-4a2 2 0 0 1 4 0v4' },
  dungeon:  { name: 'Dungeon',   d: 'M3 20h18M6 20v-8a6 6 0 0 1 12 0v8M9.5 20v-6h5v6M12 14v6' },
  ruins:    { name: 'Ruins',     d: 'M5 20V9M9 20v-7M15 20V7M19 20v-5M3 20h18M3.5 9h3M13.5 7h3' },
  tavern:   { name: 'Tavern',    d: 'M6 8h9v11a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1zM15 11h2a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-2M8 5c1-1 2-1 3 0s2 1 3 0' },
  temple:   { name: 'Temple',    d: 'M3 9l9-5 9 5zM5.5 9v10M10 9v10M14 9v10M18.5 9v10M3 20h18' },
  cave:     { name: 'Cave',      d: 'M3 19c1-6 4-11 9-11s8 5 9 11zM9 19c0-3 1.3-5 3-5s3 2 3 5' },
  camp:     { name: 'Camp',      d: 'M12 5L3 20h18zM12 12l-3 8M12 12l3 8' },
  port:     { name: 'Port',      d: 'M12 3.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM12 7.5V20M8.5 11h7M5 14a7 7 0 0 0 14 0' },
  landmark: { name: 'Landmark',  d: 'M10 20l1-14 1-2 1 2 1 14zM7 20h10' },
  quest:    { name: 'Quest',     d: 'M12 3l9 9-9 9-9-9zM12 8v5M12 16v.5' },
  danger:   { name: 'Danger',    d: 'M6 11a6 6 0 1 1 12 0c0 2-1 3-2 3.5V18H8v-3.5C7 14 6 13 6 11zM9.5 11v.5M14.5 11v.5M10.5 18v2M13.5 18v2' },
  treasure: { name: 'Treasure',  d: 'M4 10h16v9H4zM4 10a8 4 0 0 1 16 0M4 13h16M11 12h2v3h-2z' },
};

export const PALETTE = [
  { name: 'Crimson',   hex: '#9b3a32' },
  { name: 'Royal',     hex: '#3e5c8a' },
  { name: 'Verdigris', hex: '#4f8a7c' },
  { name: 'Ochre',     hex: '#b58a3a' },
  { name: 'Amethyst',  hex: '#6e4f7a' },
  { name: 'Moss',      hex: '#5a7a45' },
  { name: 'Slate',     hex: '#5d6670' },
  { name: 'Ink',       hex: '#3a2c1e' },
];

export function buildSprite() {
  const sprite = document.getElementById('sprite');
  let html = '';
  for (const [k, d] of Object.entries(UI_ICONS)) {
    html += `<symbol id="i-${k}" viewBox="0 0 24 24"><path d="${d}"/></symbol>`;
  }
  for (const [k, v] of Object.entries(PIN_ICONS)) {
    html += `<symbol id="p-${k}" viewBox="0 0 24 24"><path d="${v.d}"/></symbol>`;
  }
  sprite.innerHTML = html;
}

export function icon(name, cls = 'i') {
  return `<svg class="${cls}"><use href="#i-${name}"/></svg>`;
}

export function pinGlyph(name, cls = 'i') {
  return `<svg class="${cls}"><use href="#p-${name}"/></svg>`;
}

// Teardrop pin body anchored at (0,0) = tip.
export const PIN_BODY = 'M0 0C-3.5-7-12.5-12.5-12.5-22.5a12.5 12.5 0 1 1 25 0C12.5-12.5 3.5-7 0 0Z';
export const PIN_HEAD_Y = -22.5;
