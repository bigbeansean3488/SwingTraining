// IndexedDB persistence for sessions and swings. Videos are NOT stored.
// Works with the browser's indexedDB or an injected implementation (tests).

const DB_NAME = 'swingtraining';
const DB_VERSION = 1;

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function openStore(idb = globalThis.indexedDB, name = DB_NAME, { timeoutMs = 5000 } = {}) {
  if (!idb) throw new Error('IndexedDB is not available in this browser');
  const open = idb.open(name, DB_VERSION);
  open.onblocked = () => console.warn('IndexedDB open blocked by another open connection');
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('swings')) {
      const s = db.createObjectStore('swings', { keyPath: 'id' });
      s.createIndex('sessionId', 'sessionId');
    }
    if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
  };
  // Never let a stuck open (e.g. a previous page still holding a connection)
  // hang the app: fail visibly after a timeout instead.
  let timer;
  const db = await Promise.race([
    req(open),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out opening local storage')), timeoutMs); }),
  ]).finally(() => clearTimeout(timer));
  db.onversionchange = () => db.close();
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => db.close(), { once: true });

  const put = async (store, value) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await txDone(tx);
    return value;
  };

  return {
    db,
    putSession: (s) => put('sessions', s),
    putSwing: (s) => put('swings', s),
    async putSwings(swings) {
      const tx = db.transaction('swings', 'readwrite');
      for (const s of swings) tx.objectStore('swings').put(s);
      await txDone(tx);
    },
    async getSession(id) {
      return req(db.transaction('sessions').objectStore('sessions').get(id));
    },
    async listSessions() {
      const all = await req(db.transaction('sessions').objectStore('sessions').getAll());
      return all.sort((a, b) => b.createdAt - a.createdAt);
    },
    async listSwings(sessionId) {
      const all = await req(db.transaction('swings').objectStore('swings').index('sessionId').getAll(sessionId));
      return all.sort((a, b) => a.number - b.number);
    },
    async deleteSwing(id) {
      const tx = db.transaction('swings', 'readwrite');
      tx.objectStore('swings').delete(id);
      await txDone(tx);
    },
    async deleteSession(id) {
      const swings = await this.listSwings(id);
      const tx = db.transaction(['sessions', 'swings'], 'readwrite');
      tx.objectStore('sessions').delete(id);
      for (const s of swings) tx.objectStore('swings').delete(s.id);
      await txDone(tx);
    },
    async getMeta(key) {
      return (await req(db.transaction('meta').objectStore('meta').get(key)))?.value;
    },
    setMeta: (key, value) => put('meta', { key, value }),
    close: () => db.close(),
  };
}
