# Table Viewer (CSV/TSV, VSCode-style)

A browser-based app for viewing `.csv`/`.tsv` files in a folder as sortable,
filterable grids — with persistent tabs and a "recent folders" list backed
by SQLite (via WASM), similar to how VSCode remembers open folders and tabs.
Runs entirely client-side — no backend server.

## Requirements

- **Chrome, Edge, or another Chromium-based browser.** The app uses the
  [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API)
  to read local folders directly from the browser, which isn't supported in
  Firefox or Safari yet.

## Setup

```bash
npm install
npm run dev
```

Then open the printed **http://localhost:5173** URL in Chrome or Edge.

## Deploying

```bash
npm run deploy
```

Builds the app and publishes `dist/` to GitHub Pages via `gh-pages`. The
custom domain lives in `static-assets/CNAME` and is copied into every build.

## Usage

1. Click **Open Folder…** and pick a folder using your browser's native
   folder picker. The browser will ask you to confirm read access — this
   permission is scoped to that one folder.
2. All `.csv`/`.tsv`/`.tab`/`.txt` files found recursively in that folder
   appear in the sidebar as a **nested, expandable folder tree** (click a
   folder row, or its ▸/▾ arrow, to expand/collapse it). Folders use a
   folder icon; each file type gets its own color-coded icon.
3. Click a file to open it in a **tab** — tabs stay open permanently (no
   VSCode preview-mode replacement), so you can have several files open
   side by side and switch freely.
   - **Right-click a tab** for a context menu: Close, Close Others, Close
     to the Right, Close to the Left, Close All.
4. Click a column header to sort (click again to reverse). Use the filter
   box above the grid to search across all columns.
5. Previously opened folders show under the **Recent Folders** dropdown
   (▸ Recent Folders — click the header to expand/collapse; it starts
   closed). Click an entry to reopen it, or the ✕ to remove it. The app
   also remembers the last folder you had open and tries to reopen it
   automatically next visit.
   - Browsers don't always keep folder-access permission granted across
     restarts. When that happens you'll see a **🔓 Reopen "folder"**
     button instead of the folder auto-loading — one click re-grants
     access. Recent Folders entries show a 🔒 badge when they'll need
     that same re-click.
6. **Drag the thin divider** between the sidebar and the grid to resize
   the sidebar's width; it's remembered next time you open the app.
7. Use the **Columns ▾** dropdown above the grid to show/hide individual
   columns via checkboxes (with Show all / Hide all shortcuts).
8. Each row has a checkbox on the left; check one or more rows and click
   **Hide Selected Rows** to tuck them out of view. Click **Show Hidden
   Rows (n)** to bring them all back.

## How it's structured

- `public/app.js` — the whole app: folder tree, tabs, grid rendering,
  filtering/sorting, and all File System Access API calls (folder picking,
  recursive directory walk, reading file contents).
- `public/fsStore.js` — persistence layer. Recent-folder metadata (name,
  last-opened time) lives in a real SQLite database via
  `@sqlite.org/sqlite-wasm`, backed by `localStorage` (no server, no Web
  Worker, no special HTTP headers required — works on plain static
  hosting). The actual `FileSystemDirectoryHandle`/`FileSystemFileHandle`
  objects can't be stored in SQL columns, so those live separately in
  IndexedDB, keyed by the same id as their SQLite row.
- `public/settings.js` — small UI preferences (sidebar width, collapsed
  state) in `localStorage`.
- `static-assets/CNAME` — the custom-domain file for GitHub Pages. Kept
  outside `public/` and pointed to via `publicDir` in `vite.config.js`,
  since Vite's `root` is already set to `public/`.

## Notes / limits

- Files over 25MB are not loaded (safety cap for in-browser rendering);
  raise `MAX_FILE_BYTES` in `public/app.js` if you need larger files.
- Only the first 5,000 filtered rows are rendered in the DOM at once for
  performance — narrow with the filter box to see more.
- Folder access is per-browser-profile and per-origin — recent folders
  won't carry over between browsers or devices.

## Extending it

- Swap the custom grid for **AG Grid** or **Handsontable** if you want
  Excel-style inline cell editing.
- Add a SQL-like filter (e.g. via **AlaSQL**) for RBQL-style querying
  across files.
