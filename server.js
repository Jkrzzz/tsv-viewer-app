import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";
import store from "./db.js";

// Recreate __dirname and __filename for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const TABLE_EXTENSIONS = new Set([".csv", ".tsv", ".tab", ".txt"]);

// Recursively walk a folder collecting .csv/.tsv files, mirroring how
// VSCode's Explorer walks a workspace folder. Skips common noise dirs.
const SKIP_DIRS = new Set(["node_modules", ".git", ".vscode", "dist", "build"]);

function readFolderFiles(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return []; // Handle permission errors gracefully
  }

  const results = [];
  for (const entry of entries) {
    // Skip hidden files/folders, specified noise directories, and subdirectories
    if (
      entry.name.startsWith(".") ||
      entry.isDirectory() ||
      SKIP_DIRS.has(entry.name)
    ) {
      continue;
    }

    const ext = path.extname(entry.name).toLowerCase();
    if (TABLE_EXTENSIONS.has(ext)) {
      const fullPath = path.join(dirPath, entry.name);
      results.push({
        name: entry.name,
        fullPath,
        relativePath: entry.name,
        ext,
        size: fs.statSync(fullPath).size,
      });
    }
  }
  return results;
}

// --- Folder endpoints ---------------------------------------------------

app.post("/api/folder/open", (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || !fs.existsSync(folderPath)) {
    return res.status(400).json({ error: "Folder does not exist" });
  }
  if (!fs.statSync(folderPath).isDirectory()) {
    return res.status(400).json({ error: "Path is not a folder" });
  }

  const files = readFolderFiles(folderPath);
  store.touchFolder(folderPath);

  res.json({ folderPath, files });
});

app.get("/api/folder/recent", (req, res) => {
  res.json(store.getRecentFolders());
});

app.get("/api/folder/last", (req, res) => {
  const last = store.getState("lastOpenedFolder");
  res.json({ folderPath: last });
});

app.delete("/api/folder/recent", (req, res) => {
  const { folderPath } = req.body;
  store.removeFolder(folderPath);
  res.json({ ok: true });
});

// --- Folder BROWSER endpoints (in-app, since browsers can't hand a real
// filesystem path to server code from a native picker) --------------------

function listRoots() {
  if (process.platform === "win32") {
    // Probe drive letters A: through Z: for existence.
    const roots = [];
    for (let code = 65; code <= 90; code++) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) roots.push({ name: drive, fullPath: drive });
    }
    return roots;
  }
  // macOS / Linux — root of the filesystem, plus the user's home dir as
  // a convenient shortcut.
  const home = os.homedir();
  return [
    { name: "/ (Root)", fullPath: "/" },
    { name: `Home (${home})`, fullPath: home },
  ];
}

app.get("/api/browse/roots", (req, res) => {
  res.json({ roots: listRoots() });
});

app.get("/api/browse", (req, res) => {
  const dirPath = req.query.dirPath;
  if (!dirPath) {
    return res.json({ dirPath: null, parent: null, entries: listRoots() });
  }
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    return res.status(400).json({ error: "Not a valid directory" });
  }

  let entries;
  try {
    entries = fs
      .readdirSync(dirPath, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith("."))
      .map((e) => ({ name: e.name, fullPath: path.join(dirPath, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (err) {
    return res
      .status(403)
      .json({ error: "Cannot read this directory (permission denied)" });
  }

  // 1. Parse path components
  const resolvedPath = path.resolve(dirPath);
  const parsed = path.parse(resolvedPath);

  // 2. Check if we are at the drive root (e.g. resolvedPath === "C:\\")
  const isDriveRoot = resolvedPath === parsed.root;

  // 3. Set parentPath to "" if at drive root, otherwise get dirname
  const parentPath = isDriveRoot ? "" : path.dirname(resolvedPath);

  res.json({ dirPath: resolvedPath, parent: parentPath, entries });
});
// --- File content endpoint ----------------------------------------------

app.get("/api/file", (req, res) => {
  const { fullPath } = req.query;
  if (!fullPath || !fs.existsSync(fullPath)) {
    return res.status(404).json({ error: "File not found" });
  }
  const stat = fs.statSync(fullPath);
  const MAX_BYTES = 25 * 1024 * 1024; // 25MB safety cap for in-browser grid
  if (stat.size > MAX_BYTES) {
    return res
      .status(413)
      .json({ error: "File too large to preview (25MB limit)" });
  }
  const content = fs.readFileSync(fullPath, "utf-8");
  const ext = path.extname(fullPath).toLowerCase();
  let type = "table";
  let delimiter = "\t";

  if (ext === ".csv") {
    delimiter = ",";
  } else if (ext === ".txt") {
    type = "text";
  }
  res.json({ content, delimiter, type, ext });
});

app.listen(PORT, "127.0.0.1", () => {
  console.log(`TSV/CSV viewer running at http://127.0.0.1:${PORT}`);
});
