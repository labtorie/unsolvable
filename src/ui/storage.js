// Хранилище снимков и веток в IndexedDB (мир большой, localStorage не подходит).
// Всё в try/catch: без хранилища интерфейс просто живёт без памяти между перезагрузками.
const DB_NAME = 'unsolvable', DB_VER = 1;
const STORES = ['snapshots', 'branches'];
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return dbPromise;
}

function run(store, mode, fn) {
  return open().then(db => new Promise(resolve => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, mode);
      const res = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(res?.result ?? true);
      tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  })).catch(() => null);
}

export async function loadSaved() {
  const out = { snapshots: [], branches: [] };
  try {
    for (const s of STORES) {
      const rows = await run(s, 'readonly', st => st.getAll());
      if (Array.isArray(rows)) out[s] = rows.filter(r => r && typeof r.id === 'number').sort((a, b) => a.id - b.id);
    }
  } catch { /* ignore */ }
  return out;
}
export function putSaved(store, item) { return run(store, 'readwrite', st => st.put(item)); }
export function deleteSaved(store, id) { return run(store, 'readwrite', st => st.delete(id)); }
