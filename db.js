import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Store the db in a local data folder, similar to how VSCode keeps
// state.vscdb in its userData directory rather than inside a project.
const dataDir = path.join(__dirname, "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "app-state.sqlite"));

db.exec(`
  CREATE TABLE IF NOT EXISTS recent_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folderPath TEXT NOT NULL UNIQUE,
    lastOpenedAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`);

function touchFolder(folderPath) {
  const now = Date.now();
  db.prepare(
    `
    INSERT INTO recent_folders (folderPath, lastOpenedAt)
    VALUES (?, ?)
    ON CONFLICT(folderPath) DO UPDATE SET lastOpenedAt = excluded.lastOpenedAt
  `,
  ).run(folderPath, now);
  setState("lastOpenedFolder", folderPath);
}

function getRecentFolders(limit = 10) {
  return db
    .prepare(
      `
    SELECT folderPath, lastOpenedAt FROM recent_folders
    ORDER BY lastOpenedAt DESC
    LIMIT ?
  `,
    )
    .all(limit);
}

function removeFolder(folderPath) {
  db.prepare(`DELETE FROM recent_folders WHERE folderPath = ?`).run(folderPath);
}

function setState(key, value) {
  db.prepare(
    `
    INSERT INTO app_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `,
  ).run(key, value);
}

function getState(key) {
  const row = db.prepare(`SELECT value FROM app_state WHERE key = ?`).get(key);
  return row ? row.value : null;
}

export default {
  touchFolder,
  getRecentFolders,
  removeFolder,
  setState,
  getState,
};
