# Table Viewer (CSV/TSV, VSCode-style)

A browser-based app for viewing `.csv`/`.tsv` files in a folder as sortable,
filterable grids — with persistent tabs and a "recent folders" list backed
by SQLite (via WASM), similar to how VSCode remembers open folders and tabs.
Runs entirely client-side — no backend server. Responsive: works as a
full desktop layout or as a mobile-friendly off-canvas drawer.

## Requirements

- **Chrome, Edge, or another Chromium-based browser** gets the full
  experience, via the
  [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API):
  reusable folder handles, **Recent Folders**, and auto-resuming your last
  folder on reload. This includes Chrome/Edge on Android (folder access
  shipped there in Chrome 132+).
- **Safari, Firefox, and any other browser without that API** still work,
  via an `<input type="file" webkitdirectory>` fallback: you can open a
  folder and browse its files, just without a reusable handle — so no
  Recent Folders entry gets saved, and you'll need to reselect the folder
  next time. The app detects which mode is available and adjusts the UI
  (and its explanatory note) automatically.

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
   the sidebar's width; it's remembered next time you open the app. (On
   mobile this divider is hidden — see "On mobile" below.)
7. Use the **Columns ▾** dropdown above the grid to show/hide individual
   columns via checkboxes (with Show all / Hide all shortcuts). It sits
   last in the toolbar on purpose: its panel opens right-aligned to its
   own button, so keeping it rightmost stops the panel from running off
   the left edge on narrow screens.
8. Each row has a checkbox on the left; check one or more rows and click
   **Hide Selected Rows** to tuck them out of view. Click **Show Hidden
   Rows (n)** to bring them all back.
9. Opening a file you haven't opened yet shows a brief loading spinner
   while it's read and parsed; reopening an already-open tab is instant
   (the parsed data stays cached in memory for the session), and each
   tab remembers its own scroll position independently.

## On mobile

Below ~768px wide, the sidebar becomes an off-canvas drawer instead of a
permanent side panel:

- Tap **☰** in the top bar to open it, or the **✕** in its top-right
  corner (or tap outside it) to close it.
- Opening a file or a folder automatically closes the drawer.
- The top bar shows the current file's name.
- The table header row stays pinned (`position: sticky`) while you
  scroll down; the filter/toolbar row stays pinned horizontally while
  you scroll a wide table sideways, but scrolls away normally with the
  rest of the content vertically.

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
- `static-assets/favicon.ico` / `favicon.svg` / `apple-touch-icon.png` —
  app icon (dark tile with a table/grid glyph in the app's own accent and
  TSV file-type colors). Linked from `public/index.html`.
- `static-assets/CNAME` — the custom-domain file for GitHub Pages. Kept
  outside `public/` and pointed to via `publicDir` in `vite.config.js`,
  since Vite's `root` is already set to `public/`.

## Notes / limits

- Files over 25MB are not loaded (safety cap for in-browser rendering);
  raise `maxFileBytes` in `public/settings.js` if you need larger files.
- Rows are rendered virtually (windowed) — only the rows scrolled into
  view get real DOM nodes, with two spacer rows standing in for the rest.
  So render cost stays flat regardless of file size; there's no row-count
  cap on what you can filter/scroll through.
- Folder access is per-browser-profile and per-origin — recent folders
  won't carry over between browsers or devices. In the `webkitdirectory`
  fallback mode (see Requirements), there's no reusable handle at all, so
  nothing gets remembered between visits.

## Extending it

- Swap the custom grid for **AG Grid** or **Handsontable** if you want
  Excel-style inline cell editing.
- Add a SQL-like filter (e.g. via **AlaSQL**) for RBQL-style querying
  across files.
