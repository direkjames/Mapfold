# Developing Mapfold

Notes for running and changing Mapfold. For what it does, see the [README](../README.md).

## Run it

Mapfold uses ES modules and a service worker, so it must be served over HTTP
(opening `index.html` straight from disk will not work).

- **VS Code:** right-click `index.html` → *Open with Live Server*.
- **GitHub Pages:** put this folder at `direkjames.github.io/mapfold/`. All paths are relative.

The README images are in `docs/screenshots/`. They show a made-up sample world.

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
js/link.js            the Inkfold share (publishes to the mapfold-link database)
js/store.js           world/map model, .mapfold export/import (id remapping), Inkfold interchange
js/nest.js            map nesting: breadcrumb trail, outline, loop-safe parent choices (no DOM)
js/calendar.js        custom calendars: day numbers to dates and back (no DOM)
js/timeline.js        calendar editor, date pickers, timeline view
js/table.js           fog masks, party token, travel maths (no DOM)
js/tabletop.js        fog and party panels, the player window sync
js/player.js          the player window (receives pictures only)
player.html           the player window page
js/entries.js         wiki entry model: types, [[id|name]] links, search, reading view (no DOM)
js/wiki.js            the wiki panel, quick switcher, [[ typing help, linking pins to entries
js/db.js              IndexedDB wrapper
js/zip.js             small ZIP writer/reader (no dependencies)
js/icons.js           UI icons, pin symbols, colour palette
js/ui.js              dialogs, toasts, helpers
```

## Inkfold interchange (for the Inkfold importer)

"Export → Inkfold file" downloads `<map>.inkfold-map.zip` containing:

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
  "version": 2,
  "source": { "app": "Mapfold", "author": "direk james", "worldId": "...", "worldName": "...", "mapId": "...", "mapName": "...", "parentMapId": null, "revision": 1700000000000 },
  "scale": { "perCell": 10, "unit": "mi", "cellPx": 64 },
  "image": { "file": "map.png", "width": 3200, "height": 2400, "rendered": "rendered.png" },
  "pins":    [{ "id": "...", "x": 0.47, "y": 0.52, "label": "Varn", "icon": "city", "color": "#9b3a32", "note": "" }],
  "labels":  [{ "id": "...", "x": 0.5, "y": 0.1, "text": "Thornwake", "style": "realm", "size": 0.03, "rotation": 0, "color": null }],
  "regions": [{ "id": "...", "name": "...", "color": "#9b3a32", "points": [[0.1, 0.2], [0.3, 0.2], [0.3, 0.4]], "note": "" }],
  "routes":  [{ "id": "...", "name": "...", "kind": "road", "color": null, "points": [[0.1, 0.2], [0.4, 0.5]], "note": "", "entryId": null, "secret": false }],
  "entries": [{ "id": "...", "type": "place", "name": "Varn", "aliases": [], "tags": ["port"], "fields": { "kind": "City" }, "body": "Plain text, links shown as names." }]
}
```

`pins`, `regions` and `routes` may carry an `entryId` pointing into `entries` (only public entries are included, with `||secret||` text removed). Secret pins, labels, regions, routes and entries are omitted from the package altogether (Inkfold has no secret flag). Pins may carry `opensMap` (a nested map's id). Regions add `fill`, `border` and `smooth`; routes add `width` and `smooth`. `source.updated` is the map's last-saved time in milliseconds. `labels[].size` is a fraction of image height. `route.kind` is `road`, `trail`, `river` or `sea`.
IDs are stable, so Inkfold can re-import an updated map and match existing pins.

## `.mapfold` world file

A ZIP with `world.json` (format `mapfold`, version 2; version 1 files still import, and it now also holds `entries`), `images/<mapId>-base` (uploaded map image, if any),
`images/<mapId>-terrain.png` and `thumb.png`. Importing into a browser that doesn't have the world restores it with the same ids; if it is already there, a copy with new ids is made.
