// Storage for "recent folders": a real SQLite database (via sqlite-wasm's
// kvvfs backend, which stores its pages in localStorage — no OPFS, no
// Worker, no special HTTP headers needed, so this works on plain static
// hosting like GitHub Pages) holds the folder metadata (name, last-opened
// time). A live FileSystemDirectoryHandle can't be serialized into a SQL
// column though — only IndexedDB's structured-clone storage can hold one —
// so the actual handles live there, keyed by the same id as the SQLite row.

import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

const IDB_NAME = "tsvViewerHandles";
const IDB_VERSION = 1;
const IDB_STORE = "handles";

let sqlite3Promise = null;
let db = null;

async function getDb() {
  if (db) return db;
  if (!sqlite3Promise) sqlite3Promise = sqlite3InitModule();
  const sqlite3 = await sqlite3Promise;
  db = new sqlite3.oo1.JsStorageDb("local");
  db.exec(`
    CREATE TABLE IF NOT EXISTS recent_folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      last_opened INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

// ---------- IndexedDB: raw handle storage only ----------

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGetHandle(id) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSetHandle(id, handle) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDeleteHandle(id) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Public API (same shape app.js already expects) ----------

export async function touchRecentFolder(handle) {
  const database = await getDb();

  // De-dupe against folders already saved, by comparing live handles —
  // SQLite only has the name, so the actual identity check has to happen
  // against the handles sitting in IndexedDB.
  const rows = database.exec({
    sql: "SELECT id FROM recent_folders",
    rowMode: "object",
    returnValue: "resultRows",
  });
  let id = null;
  for (const row of rows) {
    try {
      const existingHandle = await idbGetHandle(row.id);
      if (existingHandle && (await existingHandle.isSameEntry(handle))) {
        id = row.id;
        break;
      }
    } catch {
      // stale/missing handle — ignore and keep looking
    }
  }
  if (!id) id = crypto.randomUUID();

  await idbSetHandle(id, handle);

  const now = Date.now();
  database.exec({
    sql: `INSERT INTO recent_folders (id, name, last_opened) VALUES ($id, $name, $t)
          ON CONFLICT(id) DO UPDATE SET name = $name, last_opened = $t`,
    bind: { $id: id, $name: handle.name, $t: now },
  });
  database.exec({
    sql: `INSERT INTO app_meta (key, value) VALUES ('lastOpenedFolder', $id)
          ON CONFLICT(key) DO UPDATE SET value = $id`,
    bind: { $id: id },
  });
}

export async function getRecentFolders(limit = 8) {
  const database = await getDb();
  const rows = database.exec({
    sql: "SELECT id, name, last_opened FROM recent_folders ORDER BY last_opened DESC LIMIT $limit",
    bind: { $limit: limit },
    rowMode: "object",
    returnValue: "resultRows",
  });

  const out = [];
  for (const row of rows) {
    const handle = await idbGetHandle(row.id);
    if (!handle) continue; // metadata/handle got out of sync — skip it
    out.push({ id: row.id, name: row.name, lastOpened: row.last_opened, handle });
  }
  return out;
}

export async function removeRecentFolder(id) {
  const database = await getDb();
  database.exec({ sql: "DELETE FROM recent_folders WHERE id = $id", bind: { $id: id } });
  database.exec({
    sql: "DELETE FROM app_meta WHERE key = 'lastOpenedFolder' AND value = $id",
    bind: { $id: id },
  });
  await idbDeleteHandle(id);
}

export async function getLastOpenedFolder() {
  const database = await getDb();
  const rows = database.exec({
    sql: "SELECT value FROM app_meta WHERE key = 'lastOpenedFolder'",
    rowMode: "object",
    returnValue: "resultRows",
  });
  if (!rows.length) return null;
  return idbGetHandle(rows[0].value);
}

// ---------- Permission handling ----------
//
// Browsers only remember a folder-access grant for so long (often just the
// current tab session, sometimes cleared on restart), so a restored handle
// frequently comes back in the "prompt" state rather than "granted". Any
// *request* (as opposed to a query) must happen inside a user gesture (a
// click handler) or the browser will reject it outright — callers that
// can't guarantee a gesture should pass requestIfNeeded=false and handle a
// `false` return by asking the user to click something first.
export async function verifyPermission(handle, requestIfNeeded = true) {
  const opts = { mode: "read" };
  try {
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if (!requestIfNeeded) return false;
    return (await handle.requestPermission(opts)) === "granted";
  } catch (err) {
    // Handle can throw (e.g. NotAllowedError outside a user gesture, or the
    // underlying folder/drive no longer exists) — treat both as "no access".
    console.error("Permission check failed:", err);
    return false;
  }
}

export async function permissionState(handle) {
  try {
    return await handle.queryPermission({ mode: "read" });
  } catch {
    return "denied";
  }
}
