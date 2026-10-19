// Mapfold — IndexedDB storage. Author: direk james
const DB_NAME = 'mapfold';
const DB_VERSION = 2; // v2 adds the wiki `entries` store; v1 worlds open unchanged
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('maps')) {
        const s = db.createObjectStore('maps', { keyPath: 'id' });
        s.createIndex('worldId', 'worldId');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('worldId', 'worldId');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Another tab (or Inkfold) is upgrading the database: step aside instead of blocking it.
      db.onversionchange = () => { db.close(); dbp = null; };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Mapfold is open in another tab. Close it and reload.'));
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then(r => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const wrap = req => new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); });

export const db = {
  async allWorlds() {
    return tx('worlds', 'readonly', s => wrap(s.getAll()));
  },
  getWorld(id) { return tx('worlds', 'readonly', s => wrap(s.get(id))); },
  putWorld(w) { return tx('worlds', 'readwrite', s => { s.put(w); }); },
  async deleteWorld(id) {
    const maps = await this.mapsOf(id);
    for (const m of maps) await this.deleteMap(m.id);
    await this.deleteEntriesOf(id);
    await tx('blobs', 'readwrite', s => { s.delete('thumb:' + id); });
    return tx('worlds', 'readwrite', s => { s.delete(id); });
  },
  mapsOf(worldId) {
    return tx('maps', 'readonly', s => wrap(s.index('worldId').getAll(worldId)));
  },
  getMap(id) { return tx('maps', 'readonly', s => wrap(s.get(id))); },
  putMap(m) { return tx('maps', 'readwrite', s => { s.put(m); }); },
  async deleteMap(id) {
    await tx('blobs', 'readwrite', s => { s.delete('terrain:' + id); s.delete('base:' + id); s.delete('fog:' + id); });
    return tx('maps', 'readwrite', s => { s.delete(id); });
  },
  entriesOf(worldId) {
    return tx('entries', 'readonly', s => wrap(s.index('worldId').getAll(worldId)));
  },
  getEntry(id) { return tx('entries', 'readonly', s => wrap(s.get(id))); },
  putEntry(e) { return tx('entries', 'readwrite', s => { s.put(e); }); },
  putEntries(list) { return tx('entries', 'readwrite', s => { list.forEach(e => s.put(e)); }); },
  deleteEntry(id) { return tx('entries', 'readwrite', s => { s.delete(id); }); },
  async deleteEntriesOf(worldId) {
    const list = await this.entriesOf(worldId);
    return tx('entries', 'readwrite', s => { list.forEach(e => s.delete(e.id)); });
  },
  async getBlob(key) {
    const r = await tx('blobs', 'readonly', s => wrap(s.get(key)));
    return r ? r.blob : null;
  },
  putBlob(key, blob) { return tx('blobs', 'readwrite', s => { s.put({ key, blob }); }); },
  deleteBlob(key) { return tx('blobs', 'readwrite', s => { s.delete(key); }); },
};

export function uid(prefix = '') {
  const r = crypto.getRandomValues(new Uint32Array(2));
  return prefix + r[0].toString(36) + r[1].toString(36).slice(0, 4);
}
