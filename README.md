# Table Viewer (CSV/TSV, VSCode-style)

A local web app for browsing `.csv`/`.tsv` files in a folder as sortable,
filterable grids — with persistent tabs and a "recent folders" list backed
by local SQLite, similar to how VSCode remembers open folders and tabs.

## Requirements

- **Node.js 22.5 or newer** (needed for the built-in `node:sqlite` module).
  Check with `node --version`. If you're on an older version, upgrade
  Node — this app deliberately avoids native modules like
  `better-sqlite3` so there's no C++ build tools / Visual Studio
  requirement on Windows.

## Setup

```bash
npm install
npm start
```

Then open **http://localhost:4173** in your browser.

You'll see `(node:...) ExperimentalWarning: SQLite is an experimental
feature` printed on startup — that's expected and harmless; `node:sqlite`
is still marked experimental by Node but is fully functional.

## Usage

1. Paste an **absolute folder path** into the input at the top of the
   sidebar (e.g. `/Users/you/Documents/data` or `C:\Users\you\data`) and
   click **Open**, or click **Browse…** to navigate folders visually
   (Explorer-style folder icons). Since this runs as a local Node
   server, it reads real folder paths directly — there's no browser
   file-picker restriction.
2. All `.csv`/`.tsv`/`.tab` files found recursively in that folder
   appear in the sidebar as a **nested, expandable folder tree** (click
   a folder row, or its ▸/▾ arrow, to expand/collapse it). Folders use
   a folder icon; `.csv`/`.tsv`/`.tab` files each get their own
   color-coded file icon.
3. Click a file to open it in a **tab** — tabs stay open permanently
   (no VSCode preview-mode replacement), so you can have several files
   open side by side and switch freely.
   - **Right-click a tab** for a context menu: Close, Close Others,
     Close to the Right, Close to the Left, Close All.
4. Click a column header to sort (click again to reverse). Use the
   filter box above the grid to search across all columns.
5. Previously opened folders show under the **Recent Folders**
   dropdown (▸ Recent Folders — click the header to expand/collapse;
   it starts closed). Click an entry to reopen it, or the ✕ to remove
   it. The app also remembers the last folder you had open and
   reopens it automatically next launch.
6. **Drag the thin divider** between the sidebar and the grid to
   resize the sidebar's width; it's remembered next time you open the
   app.
7. Use the **Columns ▾** dropdown above the grid to show/hide
   individual columns via checkboxes (with Show all / Hide all
   shortcuts).
8. Each row has a checkbox on the left; check one or more rows and
   click **Hide Selected Rows** to tuck them out of view. Click
   **Show Hidden Rows (n)** to bring them all back.

## How it's structured

- `server.js` — Express server: folder scanning, file reading, API routes.
- `db.js` — wrapper around Node's built-in `node:sqlite` module, storing
  recent folders + last-opened state in `data/app-state.sqlite` (created
  on first run, gitignored). No native/compiled dependency involved.
- `public/` — plain HTML/CSS/JS frontend (PapaParse for CSV/TSV parsing,
  a lightweight custom grid — no heavy framework). PapaParse is an npm
  dependency (not a CDN script) — `server.js` serves it straight out of
  `node_modules/papaparse` at `/vendor/papaparse/papaparse.min.js`, so
  the app works fully offline.

## Notes / limits

- Files over 25MB are not loaded (safety cap for in-browser rendering);
  raise `MAX_BYTES` in `server.js` if you need larger files.
- Only the first 5,000 filtered rows are rendered in the DOM at once
  for performance — narrow with the filter box to see more.
- This is a local single-user tool (no auth) — intended to run on your
  own machine, not to be exposed on a shared network as-is.

## Extending it

- Swap the custom grid for **AG Grid** or **Handsontable** if you want
  Excel-style inline cell editing.
- Add a SQL-like filter (e.g. via **AlaSQL**) for RBQL-style querying
  across files.
- Add a native folder-picker dialog by wrapping this in **Electron**
  instead of a plain browser tab, if you'd rather not paste paths.
