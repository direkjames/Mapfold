// Mapfold — wiki entries (the shared model behind places, characters, factions and events). Author: direk james
//
//   entry { id, worldId, type, name, aliases[], tags[], fields{}, body, secret, created, updated }
//
// Links between entries live in `body` as [[id|Shown name]], so renaming an entry never breaks a link.
import { uid } from './db.js';

export const ENTRY_TYPES = {
  place:     { name: 'Place',     plural: 'Places' },
  character: { name: 'Character', plural: 'Characters' },
  faction:   { name: 'Faction',   plural: 'Factions' },
  item:      { name: 'Item',      plural: 'Items' },
  lore:      { name: 'Lore',      plural: 'Lore' },
  event:     { name: 'Event',     plural: 'Events' },
  note:      { name: 'Note',      plural: 'Notes' },
};

export function newEntry(worldId, type, name = '') {
  return {
    id: uid('e'), worldId,
    type: ENTRY_TYPES[type] ? type : 'note',
    name, aliases: [], tags: [], fields: {}, body: '', secret: false,
    created: Date.now(), updated: Date.now(),
  };
}

const LINK = /\[\[([A-Za-z0-9]+)\|([^\]\n]*)\]\]/g;

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
