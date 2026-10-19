# Mapfold

Offline worldbuilding and map making for dungeon masters, game masters and writers.
Sister app to **Inkfold**. Author: **direk james**.

Everything is stored in the browser (IndexedDB). Nothing is uploaded anywhere.
Export a `.mapfold` file to back up or move a world between devices.

## Running it

Mapfold uses ES modules and a service worker, so it must be served over HTTP
(opening `index.html` straight from disk will not work).

- **VS Code:** right-click `index.html` → *Open with Live Server*.
- **GitHub Pages:** put this folder at `direkjames.github.io/mapfold/`. All paths are relative.

## What's in Phase 1

- **Worlds shelf** with thumbnails, rename, export, delete, and `.mapfold` import
- **Maps:** several per world, from blank parchment (4 sizes, 4 parchment styles) or your own image
- **Terrain brush:** 8 land and sea paints, plus mountains, hills, trees, pines, reeds, waves and an ink pen for coastlines. Eraser and "Clear terrain"
- **Pins** (15 symbols), **labels** (5 lettering styles, size, rotation), **regions** (fill, border, name on map), **routes** (road, trail, river, sea lane, with length and travel time on foot)
- **Lore and tags** on every pin, region and route, plus a searchable Places list
- **Grid** (square or hex), map **scale**, scale bar and **measure** tool
- **Layers** with show/hide and lock
- **Undo/redo** for everything, including brush strokes. Autosaves as you work
- **Exports:** world file (`.mapfold`), full-size PNG, and an **Inkfold map** package
- Installable (PWA) and works offline after the first visit

Press `?` in the editor for every keyboard shortcut.

## What's new in 1.1 (Phase 2A: foundations)

- **Secret flag.** Any pin, label, region or route can be marked *Secret*. You still see it, faded with a dashed outline and a lock in the Places list, but it is left out of the player **Map image** and off the picture sent to Inkfold. **Map image, GM copy** keeps everything.
- **Safer backups.** The shelf tells you which worlds have changes that exist only in this browser (after 3 days without an export), and the footer says honestly whether the browser agreed to protect your data from automatic cleanup.
- **Restoring keeps ids.** Importing a `.mapfold` into a browser that doesn't have the world keeps every id, so wiki links and Inkfold's references still match. Importing a second copy gives the copy fresh ids and remaps everything that points at them.
- **Fonts are bundled**, so lettering looks right on the very first offline visit, and map exports no longer fall back to a default font.
- Under the hood: database version 2 with a wiki `entries` store (used from Phase 2B), world file version 2, and stricter checks on imported files (damaged or oversized data is rejected or clamped).

## Files

```
index.html
manifest.webmanifest
sw.js                 offline cache (bump VERSION when you ship changes)
css/styles.css
css/fonts.css         bundled fonts (see fonts/)
fonts/                Alegreya, Alegreya Sans and Cinzel (SIL Open Font License)
icons/
js/app.js             entry, screen switching
js/library.js         worlds shelf, new world / new map dialog
js/editor.js          the editor: view, tools, inspector, history, saving, exports
js/render.js          shared geometry and the canvas renderer used for exports
js/terrain.js         paints, stamps, eraser
js/parchment.js       procedural parchment backgrounds
js/store.js           world/map model, .mapfold export/import (id remapping), Inkfold interchange
js/entries.js         wiki entry model and [[id|name]] link helpers
js/db.js              IndexedDB wrapper
js/zip.js             small ZIP writer/reader (no dependencies)
js/icons.js           UI icons, pin symbols, colour palette
js/ui.js              dialogs, toasts, helpers
```

## Inkfold interchange (for the Inkfold importer)

"Export → Send to Inkfold" downloads `<map>.inkfold-map.zip` containing:

| File | What it is |
| --- | --- |
| `map.png` | Base image + terrain paint only, no markup. Inkfold draws its own markup on this. |
| `rendered.png` | Everything flattened, for showing the map as a plain picture. |
| `interchange.json` | The markup, described below. |

All coordinates are **normalised 0–1** against the image width and height, so they survive resizing.
Inkfold should ignore any field it doesn't know.

```json
{
  "format": "mapfold-interchange",
  "version": 1,
  "source": { "app": "Mapfold", "author": "direk james", "worldId": "...", "worldName": "...", "mapId": "...", "mapName": "..." },
  "image": { "file": "map.png", "width": 3200, "height": 2400, "rendered": "rendered.png" },
  "pins":    [{ "id": "...", "x": 0.47, "y": 0.52, "label": "Varn", "icon": "city", "color": "#9b3a32", "note": "" }],
  "labels":  [{ "id": "...", "x": 0.5, "y": 0.1, "text": "Thornwake", "style": "realm", "size": 0.03, "rotation": 0, "color": null }],
  "regions": [{ "id": "...", "name": "...", "color": "#9b3a32", "points": [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4]], "note": "" }],
  "routes":  [{ "id": "...", "name": "...", "kind": "road", "color": null, "points": [[0.1, 0.2], [0.4, 0.5]], "note": "", "secret": false }]
}
```

Every pin, label, region and route has a `secret` flag (GM-only). `rendered.png` is drawn without secret items; the JSON keeps them, flagged, so Inkfold can decide what to show. `source.updated` is the map's last-saved time in milliseconds. `labels[].size` is a fraction of image height. `route.kind` is `road`, `trail`, `river` or `sea`.
IDs are stable, so Inkfold can re-import an updated map and match existing pins.

## `.mapfold` world file

A ZIP with `world.json` (format `mapfold`, version 2; version 1 files still import, and it now also holds `entries`), `images/<mapId>-base` (uploaded map image, if any),
`images/<mapId>-terrain.png` and `thumb.png`. Importing into a browser that doesn't have the world restores it with the same ids; if it is already there, a copy with new ids is made.
