import { settings } from "./settings.js";
import Papa from "papaparse";
import {
  touchRecentFolder,
  getRecentFolders,
  removeRecentFolder,
  getLastOpenedFolder,
  verifyPermission,
  permissionState,
} from "./fsStore.js";

const TABLE_EXTENSIONS = new Set([".csv", ".tsv", ".tab", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".vscode", "dist", "build"]);

const state = {
  currentFolder: null, // display name of the open folder (handle.name)
  files: [], // flat list [{name, fullPath, relativePath, ext}]
  fileHandles: new Map(), // fullPath -> FileSystemFileHandle
  fileTree: null, // nested tree built from `files`
  expandedFolders: new Set(), // folder node paths currently expanded
  openTabs: [], // [{fullPath, name}] — order = tab order
  activeTab: null, // fullPath of active tab
  tabData: {}, // fullPath -> { headers, rows, sortCol, sortDir, filter, hiddenCols, hiddenRows, selectedRows }
};

const el = {
  app: document.getElementById("app"),
  sidebar: document.getElementById("sidebar"),
  sidebarResizer: document.getElementById("sidebar-resizer"),
  sidebarToggleBtn: document.getElementById("sidebar-toggle-btn"),
  sidebarCloseBtn: document.getElementById("sidebar-close-btn"),
  sidebarBackdrop: document.getElementById("sidebar-backdrop"),
  mobileCurrentFile: document.getElementById("mobile-current-file"),
  openFolderBtn: document.getElementById("open-folder-btn"),
  folderInputFallback: document.getElementById("folder-input-fallback"),
  unsupportedNote: document.getElementById("unsupported-browser-note"),
  fallbackModeNote: document.getElementById("fallback-mode-note"),
  recentFoldersHeader: document.getElementById("recent-folders-header"),
  recentArrow: document.getElementById("recent-arrow"),
  recentList: document.getElementById("recent-list"),
  reconnectBanner: document.getElementById("reconnect-banner"),
  fileTree: document.getElementById("file-tree"),
  currentFolderLabel: document.getElementById("current-folder-label"),
  tabBar: document.getElementById("tab-bar"),
  gridContainer: document.getElementById("grid-container"),
  contextMenu: document.getElementById("context-menu"),
};

// ---------- Icons (Explorer-style folder / typed file icons) ----------

function folderIconSVG(open) {
  const flap = open ? "#e8b660" : "#dcb67a";
  const body = open ? "#f6d087" : "#f2ce7d";
  return `<svg class="tree-icon" width="16" height="16" viewBox="0 0 32 24" xmlns="http://www.w3.org/2000/svg">
    <path fill="${flap}" d="M2 5.5C2 4.67 2.67 4 3.5 4h7.6c.4 0 .78.16 1.06.44L14 6.2h14.5c.83 0 1.5.67 1.5 1.5v14.8c0 .83-.67 1.5-1.5 1.5h-25C2.67 24 2 23.33 2 22.5V5.5Z"/>
    <path fill="${body}" d="M2 9.5C2 8.67 2.67 8 3.5 8h25c.83 0 1.5.67 1.5 1.5v11c0 .83-.67 1.5-1.5 1.5h-25C2.67 22 2 21.33 2 20.5v-11Z"/>
  </svg>`;
}

const FILE_TYPE_STYLE = {
  ".csv": { color: "#8fd19e", label: "CSV" },
  ".tsv": { color: "#7db8f5", label: "TSV" },
  ".tab": { color: "#c9a0e8", label: "TAB" },
};

function fileIconSVG(ext) {
  const cfg = FILE_TYPE_STYLE[ext] || { color: "#9d9d9d", label: "" };
  return `<svg class="tree-icon" width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
    <path d="M5.5 1.5h7l5 5v14.5a1.5 1.5 0 0 1-1.5 1.5h-10.5a1.5 1.5 0 0 1-1.5-1.5v-18a1.5 1.5 0 0 1 1.5-1.5Z"
      fill="${cfg.color}" fill-opacity="0.22" stroke="${cfg.color}" stroke-width="1.1"/>
    <path d="M12.5 1.5V6a1 1 0 0 0 1 1h4.5" fill="none" stroke="${cfg.color}" stroke-width="1.1"/>
    <text x="12" y="18" text-anchor="middle" font-size="6" font-family="Segoe UI, sans-serif" font-weight="700" fill="${cfg.color}">${cfg.label}</text>
  </svg>`;
}

// ---------- Init ----------

const supportsFileSystemAccess = "showDirectoryPicker" in window;
const supportsDirectoryInput = "webkitdirectory" in document.createElement("input");

async function init() {
  if (!supportsFileSystemAccess && !supportsDirectoryInput) {
    el.unsupportedNote.classList.remove("hidden");
    el.openFolderBtn.disabled = true;
  } else if (!supportsFileSystemAccess) {
    // Browser can still open a folder's files (e.g. mobile Safari/Firefox),
    // just can't keep a reusable handle for it — no Recent Folders/auto-resume.
    el.fallbackModeNote.classList.remove("hidden");
    document.getElementById("recent-folders").classList.add("hidden");
  }

  restoreSidebarWidth();
  restoreRecentFoldersCollapsed();
  initSidebarResizer();
  initRecentFoldersToggle();
  initGlobalDismissHandlers();
  initMobileSidebarToggle();
  initTabBarWheelScroll();

  if (!supportsFileSystemAccess) return; // nothing to resume in fallback mode

  await renderRecentFolders();

  // Try to resume the last folder. Browsers frequently do NOT keep a
  // folder-access grant across reloads/restarts, so this is very often
  // in the "prompt" state rather than "granted" — in that case we can't
  // silently reopen it (requestPermission requires a user gesture), so
  // show a one-click banner instead of just doing nothing.
  const lastHandle = await getLastOpenedFolder();
  if (lastHandle) {
    if (await verifyPermission(lastHandle, false)) {
      openFolderHandle(lastHandle);
    } else {
      showReconnectBanner(lastHandle);
    }
  }
}

function showReconnectBanner(handle) {
  el.reconnectBanner.innerHTML = "";
  el.reconnectBanner.classList.remove("hidden");
  const btn = document.createElement("button");
  btn.className = "reconnect-btn";
  btn.textContent = `🔓 Reopen "${handle.name}"`;
  btn.addEventListener("click", async () => {
    const ok = await verifyPermission(handle, true); // user gesture: OK to request
    if (ok) {
      el.reconnectBanner.classList.add("hidden");
      openFolderHandle(handle);
    } else {
      btn.textContent = `Access denied — pick "${handle.name}" again via Open Folder`;
    }
  });
  el.reconnectBanner.appendChild(btn);
}

el.openFolderBtn.addEventListener("click", async () => {
  if (supportsFileSystemAccess) {
    try {
      const dirHandle = await window.showDirectoryPicker();
      el.reconnectBanner.classList.add("hidden");
      openFolderHandle(dirHandle);
    } catch (err) {
      // User cancelled the picker — nothing to do.
      if (err.name !== "AbortError") console.error(err);
    }
  } else if (supportsDirectoryInput) {
    // Reset the value first so selecting the same folder twice in a row
    // still fires a change event.
    el.folderInputFallback.value = "";
    el.folderInputFallback.click();
  }
});

el.folderInputFallback.addEventListener("change", (e) => {
  const fileList = e.target.files;
  if (fileList && fileList.length) openFolderFileList(fileList);
});

// ---------- Mobile sidebar drawer (hamburger toggle) ----------

function initMobileSidebarToggle() {
  el.sidebarToggleBtn.addEventListener("click", () => {
    el.app.classList.toggle("sidebar-open");
  });
  el.sidebarCloseBtn.addEventListener("click", closeMobileSidebar);
  el.sidebarBackdrop.addEventListener("click", () => {
    el.app.classList.remove("sidebar-open");
  });
}

function closeMobileSidebar() {
  el.app.classList.remove("sidebar-open");
}

// ---------- Sidebar resize (mouse-hold drag) ----------

function initSidebarResizer() {
  let resizing = false;

  el.sidebarResizer.addEventListener("mousedown", (e) => {
    resizing = true;
    el.sidebarResizer.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const min = 180,
      max = 640;
    const newWidth = Math.min(Math.max(e.clientX, min), max);
    el.sidebar.style.width = newWidth + "px";
  });

  window.addEventListener("mouseup", () => {
    if (!resizing) return;
    resizing = false;
    el.sidebarResizer.classList.remove("active");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    settings.set("sidebarWidth", el.sidebar.style.width);
  });
}

function restoreSidebarWidth() {
  const saved = settings.get("sidebarWidth");
  if (saved) el.sidebar.style.width = saved;
}

// ---------- Recent Folders (collapsible dropdown, closed on first load) ----------

function initRecentFoldersToggle() {
  el.recentFoldersHeader.addEventListener("click", () => {
    const collapsed = el.recentList.classList.toggle("collapsed");
    el.recentArrow.textContent = collapsed ? "▸" : "▾";
    settings.set("recentFoldersCollapsed", collapsed);
  });
}

function restoreRecentFoldersCollapsed() {
  const collapsed = settings.get("recentFoldersCollapsed");
  el.recentList.classList.toggle("collapsed", collapsed);
  el.recentArrow.textContent = collapsed ? "▸" : "▾";
}

// ---------- Global dismiss handlers (context menu + columns panel) ----------

function initGlobalDismissHandlers() {
  document.addEventListener("click", () => {
    hideContextMenu();
    document
      .querySelectorAll(".columns-panel")
      .forEach((p) => p.classList.add("hidden"));
  });
  window.addEventListener("resize", hideContextMenu);
  document.addEventListener("scroll", hideContextMenu, true);
  window.addEventListener("blur", hideContextMenu);
}

// ---------- Tab bar: wheel-to-horizontal scroll ----------
//
// #tab-bar only scrolls horizontally (overflow-x: auto), but a plain mouse
// wheel or a trackpad without a horizontal gesture only ever sends a
// vertical delta — the browser has nothing to do with it, so the bar just
// sits there. Translate that vertical delta into horizontal scroll instead.
function initTabBarWheelScroll() {
  el.tabBar.addEventListener(
    "wheel",
    (e) => {
      if (el.tabBar.scrollWidth <= el.tabBar.clientWidth) return; // nothing to scroll
      if (e.deltaY === 0) return; // already a horizontal gesture — let it pass through natively
      el.tabBar.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
}

// ---------- Folder handling (File System Access API) ----------

// Recursively walk a directory handle collecting .csv/.tsv/.tab/.txt
// files, mirroring how the old server-side walk worked. Skips common
// noise dirs and dotfiles. Populates state.fileHandles as it goes.
async function walkDirectory(dirHandle, relativePrefix = "") {
  const results = [];
  for await (const [name, handle] of dirHandle.entries()) {
    if (name.startsWith(".")) continue;
    const relativePath = relativePrefix ? `${relativePrefix}/${name}` : name;

    if (handle.kind === "directory") {
      if (SKIP_DIRS.has(name)) continue;
      const nested = await walkDirectory(handle, relativePath);
      results.push(...nested);
      continue;
    }

    const ext = "." + (name.split(".").pop() || "").toLowerCase();
    if (!TABLE_EXTENSIONS.has(ext)) continue;

    state.fileHandles.set(relativePath, handle);
    results.push({
      name,
      fullPath: relativePath, // no real OS path in the browser sandbox
      relativePath,
      ext,
    });
  }
  return results;
}

async function openFolderHandle(dirHandle) {
  const ok = await verifyPermission(dirHandle, true);
  if (!ok) {
    alert(`Permission to read "${dirHandle.name}" was denied.`);
    return;
  }

  state.fileHandles.clear();
  let files;
  try {
    files = await walkDirectory(dirHandle);
  } catch (err) {
    // Most likely the folder was moved/deleted/ejected since it was saved.
    console.error(err);
    alert(
      `Couldn't read "${dirHandle.name}" — it may have been moved, renamed, or deleted.`,
    );
    return;
  }

  applyOpenedFolder(dirHandle.name, files);

  await touchRecentFolder(dirHandle);
  await renderRecentFolders();
}

// Fallback for browsers without the File System Access API (mobile Safari,
// Firefox, older Android WebViews): <input type="file" webkitdirectory>
// hands us a flat FileList of every file under the picked folder, each
// carrying a `webkitRelativePath` like "MyFolder/sub/data.tsv". There's no
// reusable handle here — just File objects — so each gets wrapped in a
// stub with a `getFile()` method, matching the shape loadFileData() already
// expects from a real FileSystemFileHandle. No Recent Folders entry is
// created, since there is nothing we could reopen without the user
// reselecting the folder again.
async function openFolderFileList(fileList) {
  state.fileHandles.clear();
  const files = [];
  let rootName = "Folder";

  for (const file of Array.from(fileList)) {
    const relativePath = file.webkitRelativePath || file.name;
    const parts = relativePath.split("/");
    if (parts.length > 1) rootName = parts[0];
    if (parts.some((p) => p.startsWith("."))) continue;
    if (parts.some((p) => SKIP_DIRS.has(p))) continue;

    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!TABLE_EXTENSIONS.has(ext)) continue;

    state.fileHandles.set(relativePath, { getFile: async () => file });
    files.push({ name: file.name, fullPath: relativePath, relativePath, ext });
  }

  applyOpenedFolder(rootName, files);
}

function applyOpenedFolder(name, files) {
  state.currentFolder = name;
  state.files = files;
  state.fileTree = buildFileTree(files);
  state.expandedFolders = new Set();
  if (settings.get("expandSubfoldersOnOpen")) {
    collectFolderPaths(state.fileTree, state.expandedFolders);
  }
  el.currentFolderLabel.textContent = name;
  renderFileTree();
  closeMobileSidebar();
}

async function renderRecentFolders() {
  const folders = await getRecentFolders();
  el.recentList.innerHTML = "";
  for (const { id, handle, name } of folders) {
    const permState = await permissionState(handle);
    const li = document.createElement("li");
    const lockBadge = permState !== "granted" ? `<span class="perm-lock" title="Will ask for permission again">🔒</span>` : "";
    li.innerHTML = `${folderIconSVG(false)}<span title="${escapeHtml(name)}">${escapeHtml(shorten(name))}</span>${lockBadge}<span class="remove-recent" title="Remove">✕</span>`;
    li.querySelector("span:nth-child(2)").addEventListener("click", async () => {
      const ok = await verifyPermission(handle, true); // click = user gesture
      if (ok) openFolderHandle(handle);
      else alert(`Permission to read "${name}" was denied.`);
    });
    li.querySelector(".remove-recent").addEventListener("click", async (e) => {
      e.stopPropagation();
      await removeRecentFolder(id);
      renderRecentFolders();
    });
    el.recentList.appendChild(li);
  }
}

function shorten(p, max = 34) {
  return p.length > max ? "…" + p.slice(-max) : p;
}

// ---------- Folder tree (nested, expandable, VSCode Explorer-style) ----------

function buildFileTree(files) {
  const root = { name: "", path: "", type: "folder", children: new Map() };
  files.forEach((f) => {
    const parts = f.relativePath.split(/[\\/]/).filter(Boolean);
    let node = root;
    let curPath = "";
    parts.forEach((part, idx) => {
      curPath = curPath ? curPath + "/" + part : part;
      const isFile = idx === parts.length - 1;
      if (isFile) {
        node.children.set("f:" + part, {
          name: part,
          path: curPath,
          type: "file",
          file: f,
        });
      } else {
        const key = "d:" + part;
        if (!node.children.has(key)) {
          node.children.set(key, {
            name: part,
            path: curPath,
            type: "folder",
            children: new Map(),
          });
        }
        node = node.children.get(key);
      }
    });
  });
  return root;
}

function collectFolderPaths(node, out) {
  node.children.forEach((child) => {
    if (child.type === "folder") {
      out.add(child.path);
      collectFolderPaths(child, out);
    }
  });
}

function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) => {
    if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  });
}

function buildTreeUl(node, depth) {
  const ul = document.createElement("ul");
  ul.className = depth === 0 ? "tree-root" : "tree-children";
  sortedChildren(node).forEach((child) => {
    const li = document.createElement("li");
    if (child.type === "folder") {
      li.className = "tree-folder";
      const expanded = state.expandedFolders.has(child.path);

      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = `${depth * 14 + 2}px`;
      row.innerHTML = `<span class="tree-arrow">${expanded ? "▾" : "▸"}</span>${folderIconSVG(expanded)}<span class="tree-label">${escapeHtml(child.name)}</span>`;
      row.addEventListener("click", () => {
        if (state.expandedFolders.has(child.path))
          state.expandedFolders.delete(child.path);
        else state.expandedFolders.add(child.path);
        renderFileTree();
      });
      li.appendChild(row);
      if (expanded) li.appendChild(buildTreeUl(child, depth + 1));
    } else {
      li.className = "tree-file";
      li.dataset.path = child.file.fullPath;
      const row = document.createElement("div");
      row.className = "tree-row file-row";
      row.style.paddingLeft = `${depth * 14 + 18}px`;
      row.innerHTML = `${fileIconSVG(child.file.ext)}<span class="tree-label" title="${escapeHtml(child.file.relativePath)}">${escapeHtml(child.name)}</span>`;
      row.addEventListener("click", () => openFile(child.file));
      li.appendChild(row);
    }
    ul.appendChild(li);
  });
  return ul;
}

function renderFileTree() {
  el.fileTree.innerHTML = "";
  if (state.fileTree) el.fileTree.appendChild(buildTreeUl(state.fileTree, 0));
  syncActiveHighlight();
}

function syncActiveHighlight() {
  el.fileTree.querySelectorAll("li.tree-file").forEach((li) => {
    li.classList.toggle("active", li.dataset.path === state.activeTab);
  });
}

// ---------- Tabs (persistent — no VSCode-style preview replacement) ----------

async function openFile(f) {
  const existing = state.openTabs.find((t) => t.fullPath === f.fullPath);
  if (!existing) {
    state.openTabs.push({ fullPath: f.fullPath, name: f.name });
  }
  state.activeTab = f.fullPath;

  if (!state.tabData[f.fullPath]) {
    renderTabBar();
    updateMobileCurrentFileLabel();
    showGridLoading(f.name);
    // Let the loading state actually paint before the (synchronous, and
    // potentially slow on big files) parse work below blocks the main
    // thread — otherwise the browser never gets a chance to show it.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await loadFileData(f.fullPath);
  }

  renderTabBar();
  renderGrid();
  syncActiveHighlight();
  updateMobileCurrentFileLabel();
  closeMobileSidebar();
}

function showGridLoading(name) {
  el.gridContainer.onscroll = null;
  el.gridContainer.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.id = "grid-loading";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  const label = document.createElement("div");
  label.textContent = `Reading ${name}…`;
  wrap.appendChild(spinner);
  wrap.appendChild(label);
  el.gridContainer.appendChild(wrap);
}

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25MB safety cap for in-browser grid

async function loadFileData(fullPath) {
  const handle = state.fileHandles.get(fullPath);
  if (!handle) {
    alert("File not found (folder may have changed on disk)");
    return;
  }

  const file = await handle.getFile();
  if (file.size > MAX_FILE_BYTES) {
    alert("File too large to preview (25MB limit)");
    return;
  }
  const content = await file.text();
  const ext = "." + (file.name.split(".").pop() || "").toLowerCase();

  // Handle plain text files (.txt)
  if (ext === ".txt") {
    state.tabData[fullPath] = {
      isText: true,
      content,
      scrollTop: 0,
      scrollLeft: 0,
    };
    return;
  }

  // Handle CSV / TSV grid data
  const delimiter = ext === ".csv" ? "," : "\t";
  const parsed = Papa.parse(content, {
    delimiter,
    skipEmptyLines: true,
  });
  const rawRows = parsed.data;
  const headers = rawRows.length ? rawRows[0] : [];
  state.tabData[fullPath] = {
    isText: false,
    headers,
    rows: rawRows.slice(1).map((cells, id) => ({ id, cells })),
    sortCol: null,
    sortDir: 1,
    filter: "",
    hiddenCols: new Set(),
    hiddenRows: new Set(),
    selectedRows: new Set(),
    scrollTop: 0,
    scrollLeft: 0,
  };
}

function closeTab(fullPath) {
  state.openTabs = state.openTabs.filter((t) => t.fullPath !== fullPath);
  delete state.tabData[fullPath];
  if (state.activeTab === fullPath) {
    state.activeTab = state.openTabs.length
      ? state.openTabs[state.openTabs.length - 1].fullPath
      : null;
  }
  finishTabsChange();
}

function closeOtherTabs(fullPath) {
  const keep = state.openTabs.find((t) => t.fullPath === fullPath);
  state.openTabs.forEach((t) => {
    if (t.fullPath !== fullPath) delete state.tabData[t.fullPath];
  });
  state.openTabs = keep ? [keep] : [];
  state.activeTab = keep ? keep.fullPath : null;
  finishTabsChange();
}

function closeTabsToRight(fullPath) {
  const idx = state.openTabs.findIndex((t) => t.fullPath === fullPath);
  if (idx === -1) return;
  state.openTabs
    .slice(idx + 1)
    .forEach((t) => delete state.tabData[t.fullPath]);
  state.openTabs = state.openTabs.slice(0, idx + 1);
  if (!state.openTabs.some((t) => t.fullPath === state.activeTab))
    state.activeTab = fullPath;
  finishTabsChange();
}

function closeTabsToLeft(fullPath) {
  const idx = state.openTabs.findIndex((t) => t.fullPath === fullPath);
  if (idx === -1) return;
  state.openTabs.slice(0, idx).forEach((t) => delete state.tabData[t.fullPath]);
  state.openTabs = state.openTabs.slice(idx);
  if (!state.openTabs.some((t) => t.fullPath === state.activeTab))
    state.activeTab = fullPath;
  finishTabsChange();
}

function closeAllTabs() {
  state.openTabs.forEach((t) => delete state.tabData[t.fullPath]);
  state.openTabs = [];
  state.activeTab = null;
  finishTabsChange();
}

function finishTabsChange() {
  renderTabBar();
  renderGrid();
  syncActiveHighlight();
  updateMobileCurrentFileLabel();
}

function updateMobileCurrentFileLabel() {
  const active = state.openTabs.find((t) => t.fullPath === state.activeTab);
  el.mobileCurrentFile.textContent = active ? active.name : "Table Viewer";
}

function renderTabBar() {
  el.tabBar.innerHTML = "";
  state.openTabs.forEach((t) => {
    const div = document.createElement("div");
    div.className = "tab" + (t.fullPath === state.activeTab ? " active" : "");
    div.innerHTML = `<span>${escapeHtml(t.name)}</span><span class="close-tab">✕</span>`;
    div.addEventListener("click", () => {
      state.activeTab = t.fullPath;
      renderTabBar();
      renderGrid();
      syncActiveHighlight();
      updateMobileCurrentFileLabel();
    });
    div.querySelector(".close-tab").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(t.fullPath);
    });
    div.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showTabContextMenu(e.clientX, e.clientY, t.fullPath);
    });
    el.tabBar.appendChild(div);
  });
}

// ---------- Tab right-click context menu ----------

function showTabContextMenu(x, y, fullPath) {
  const idx = state.openTabs.findIndex((t) => t.fullPath === fullPath);
  const items = [
    { label: "Close", action: () => closeTab(fullPath) },
    {
      label: "Close Others",
      action: () => closeOtherTabs(fullPath),
      disabled: state.openTabs.length <= 1,
    },
    {
      label: "Close to the Right",
      action: () => closeTabsToRight(fullPath),
      disabled: idx === state.openTabs.length - 1,
    },
    {
      label: "Close to the Left",
      action: () => closeTabsToLeft(fullPath),
      disabled: idx <= 0,
    },
    { sep: true },
    { label: "Close All", action: () => closeAllTabs() },
  ];
  renderContextMenu(items, x, y);
}

function renderContextMenu(items, x, y) {
  const menu = el.contextMenu;
  menu.innerHTML = "";
  items.forEach((item) => {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "context-menu-sep";
      menu.appendChild(sep);
      return;
    }
    const div = document.createElement("div");
    div.className = "context-menu-item" + (item.disabled ? " disabled" : "");
    div.textContent = item.label;
    if (!item.disabled) {
      div.addEventListener("click", (e) => {
        e.stopPropagation();
        item.action();
        hideContextMenu();
      });
    }
    menu.appendChild(div);
  });
  menu.classList.remove("hidden");
  menu.style.left = "0px";
  menu.style.top = "0px";
  const rect = menu.getBoundingClientRect();
  const maxX = Math.max(4, window.innerWidth - rect.width - 4);
  const maxY = Math.max(4, window.innerHeight - rect.height - 4);
  menu.style.left = Math.min(x, maxX) + "px";
  menu.style.top = Math.min(y, maxY) + "px";
}

function hideContextMenu() {
  el.contextMenu.classList.add("hidden");
}

// ---------- Grid rendering ----------

const ROW_HEIGHT = 27; // px — must stay in sync with table.grid tbody tr's rendered height below
const ROW_OVERSCAN = 12; // extra rows rendered above/below the viewport, as scroll buffer

function renderGrid() {
  el.gridContainer.onscroll = null;
  el.gridContainer.innerHTML = "";
  if (!state.activeTab) {
    const empty = document.createElement("div");
    empty.id = "empty-state";
    empty.textContent =
      "Open a folder, then click a .csv/.tsv file to view it here.";
    el.gridContainer.appendChild(empty);
    return;
  }

  const data = state.tabData[state.activeTab];
  if (!data) return;
  if (data.isText) {
    const pre = document.createElement("pre");
    pre.className = "text-preview";
    pre.textContent = data.content;
    el.gridContainer.appendChild(pre);

    el.gridContainer.scrollTop = data.scrollTop;
    el.gridContainer.scrollLeft = data.scrollLeft;
    el.gridContainer.onscroll = () => {
      data.scrollTop = el.gridContainer.scrollTop;
      data.scrollLeft = el.gridContainer.scrollLeft;
    };
    return; // Stop here - do not build the CSV table toolbar
  }
  // --- Toolbar (filter + columns dropdown + row hide/show controls) ---
  const filterBar = document.createElement("div");
  filterBar.id = "filter-bar";

  const filterInput = document.createElement("input");
  filterInput.type = "text";
  filterInput.className = "filter-input";
  filterInput.placeholder = "Filter rows… (matches any column)";
  filterInput.value = data.filter;
  filterInput.addEventListener("input", (e) => {
    data.filter = e.target.value;
    renderGrid();
    const newInput = el.gridContainer.querySelector(".filter-input");
    newInput.focus();
    newInput.setSelectionRange(e.target.value.length, e.target.value.length);
  });
  filterBar.appendChild(filterInput);

  const toolbarBtns = document.createElement("div");
  toolbarBtns.className = "toolbar-btns";

  // Columns visibility dropdown
  const columnsDropdown = document.createElement("div");
  columnsDropdown.className = "columns-dropdown";
  const columnsBtn = document.createElement("button");
  columnsBtn.className = "toolbar-btn";
  columnsBtn.textContent = `Columns${data.hiddenCols.size ? ` (${data.hiddenCols.size} hidden)` : ""} ▾`;
  const columnsPanel = document.createElement("div");
  columnsPanel.className = "columns-panel hidden";
  data.headers.forEach((h, i) => {
    const label = document.createElement("label");
    label.className = "columns-panel-item";
    const checked = !data.hiddenCols.has(i);
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = checked;
    cb.addEventListener("change", (e) => {
      if (e.target.checked) data.hiddenCols.delete(i);
      else data.hiddenCols.add(i);
      renderGrid();
    });
    const span = document.createElement("span");
    span.textContent = h || `(col ${i + 1})`;
    label.appendChild(cb);
    label.appendChild(span);
    label.addEventListener("click", (e) => e.stopPropagation());
    columnsPanel.appendChild(label);
  });
  const columnsFooter = document.createElement("div");
  columnsFooter.className = "columns-panel-footer";
  const showAllBtn = document.createElement("button");
  showAllBtn.textContent = "Show all";
  showAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    data.hiddenCols.clear();
    renderGrid();
  });
  const hideAllBtn = document.createElement("button");
  hideAllBtn.textContent = "Hide all";
  hideAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    data.headers.forEach((_, i) => data.hiddenCols.add(i));
    renderGrid();
  });
  columnsFooter.appendChild(showAllBtn);
  columnsFooter.appendChild(hideAllBtn);
  columnsPanel.appendChild(columnsFooter);
  columnsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".columns-panel").forEach((p) => {
      if (p !== columnsPanel) p.classList.add("hidden");
    });
    columnsPanel.classList.toggle("hidden");
  });
  columnsDropdown.appendChild(columnsBtn);
  columnsDropdown.appendChild(columnsPanel);

  // Row hide / show controls
  const hideRowsBtn = document.createElement("button");
  hideRowsBtn.className = "toolbar-btn";
  hideRowsBtn.textContent = "Hide Selected Rows";
  hideRowsBtn.disabled = data.selectedRows.size === 0;
  hideRowsBtn.addEventListener("click", () => {
    data.selectedRows.forEach((id) => data.hiddenRows.add(id));
    data.selectedRows.clear();
    renderGrid();
  });
  toolbarBtns.appendChild(hideRowsBtn);

  const unhideRowsBtn = document.createElement("button");
  unhideRowsBtn.className = "toolbar-btn";
  unhideRowsBtn.textContent = `Show Hidden Rows${data.hiddenRows.size ? ` (${data.hiddenRows.size})` : ""}`;
  unhideRowsBtn.disabled = data.hiddenRows.size === 0;
  unhideRowsBtn.addEventListener("click", () => {
    data.hiddenRows.clear();
    renderGrid();
  });
  toolbarBtns.appendChild(unhideRowsBtn);

  // Columns dropdown goes last: its panel is right-aligned to its own
  // button, so putting the button last (rightmost) keeps the panel from
  // running off the left edge of narrow/mobile layouts.
  toolbarBtns.appendChild(columnsDropdown);

  filterBar.appendChild(toolbarBtns);

  const rowCount = document.createElement("span");
  rowCount.className = "row-count";
  filterBar.appendChild(rowCount);

  el.gridContainer.appendChild(filterBar);

  // --- Apply hidden-rows, filter, sort ---
  let rows = data.rows.filter((r) => !data.hiddenRows.has(r.id));
  if (data.filter.trim()) {
    const needle = data.filter.toLowerCase();
    rows = rows.filter((r) =>
      r.cells.some((cell) => String(cell).toLowerCase().includes(needle)),
    );
  }
  if (data.sortCol !== null) {
    rows = [...rows].sort((a, b) => {
      const av = a.cells[data.sortCol] ?? "";
      const bv = b.cells[data.sortCol] ?? "";
      const an = parseFloat(av),
        bn = parseFloat(bv);
      let cmp;
      if (!isNaN(an) && !isNaN(bn) && av !== "" && bv !== "") {
        cmp = an - bn;
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      return cmp * data.sortDir;
    });
  }

  rowCount.textContent = `${rows.length} / ${data.rows.length} rows`;

  const table = document.createElement("table");
  table.className = "grid";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");

  const thCheckbox = document.createElement("th");
  thCheckbox.className = "checkbox-col";
  const selectAllCb = document.createElement("input");
  selectAllCb.type = "checkbox";
  selectAllCb.checked =
    rows.length > 0 && rows.every((r) => data.selectedRows.has(r.id));
  selectAllCb.title = "Select all visible rows";
  selectAllCb.addEventListener("click", (e) => e.stopPropagation());
  selectAllCb.addEventListener("change", (e) => {
    if (e.target.checked) rows.forEach((r) => data.selectedRows.add(r.id));
    else rows.forEach((r) => data.selectedRows.delete(r.id));
    renderGrid();
  });
  thCheckbox.appendChild(selectAllCb);
  headRow.appendChild(thCheckbox);

  data.headers.forEach((h, i) => {
    if (data.hiddenCols.has(i)) return;
    const th = document.createElement("th");
    let arrow = "";
    if (data.sortCol === i) arrow = data.sortDir === 1 ? " ▲" : " ▼";
    th.textContent = (h || `(col ${i + 1})`) + arrow;
    th.addEventListener("click", () => {
      if (data.sortCol === i) {
        data.sortDir *= -1;
      } else {
        data.sortCol = i;
        data.sortDir = 1;
      }
      renderGrid();
    });
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  table.appendChild(tbody);

  el.gridContainer.appendChild(table);

  // --- Virtualized (windowed) row rendering ---
  // Only the rows actually scrolled into view get real DOM nodes; the rest
  // of the (possibly huge) row count is represented by two spacer <tr>s
  // sized to keep the scrollbar/scroll position accurate. This keeps
  // render cost flat regardless of how many rows the file has, instead of
  // scaling with total row count.
  const visibleColCount =
    1 + data.headers.filter((_, i) => !data.hiddenCols.has(i)).length;

  function buildRow(r, logicalIdx) {
    const tr = document.createElement("tr");
    if (logicalIdx % 2 === 1) tr.classList.add("row-alt");
    const tdCb = document.createElement("td");
    tdCb.className = "checkbox-col";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = data.selectedRows.has(r.id);
    cb.addEventListener("change", (e) => {
      if (e.target.checked) data.selectedRows.add(r.id);
      else data.selectedRows.delete(r.id);
      renderGrid();
    });
    tdCb.appendChild(cb);
    tr.appendChild(tdCb);
    data.headers.forEach((_, i) => {
      if (data.hiddenCols.has(i)) return;
      const td = document.createElement("td");
      td.textContent = r.cells[i] ?? "";
      tr.appendChild(td);
    });
    return tr;
  }

  function spacerRow(heightPx) {
    const tr = document.createElement("tr");
    tr.className = "row-spacer";
    const td = document.createElement("td");
    td.colSpan = visibleColCount;
    td.style.cssText = `height:${heightPx}px; padding:0; border:none;`;
    tr.appendChild(td);
    return tr;
  }

  function renderVisibleRows(scrollTopOverride) {
    const scrollTop =
      scrollTopOverride !== undefined
        ? scrollTopOverride
        : el.gridContainer.scrollTop;
    const viewportHeight = el.gridContainer.clientHeight || 600;
    const total = rows.length;
    const startIdx = Math.max(
      0,
      Math.floor(scrollTop / ROW_HEIGHT) - ROW_OVERSCAN,
    );
    const endIdx = Math.min(
      total,
      Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + ROW_OVERSCAN,
    );

    tbody.innerHTML = "";
    if (startIdx > 0) tbody.appendChild(spacerRow(startIdx * ROW_HEIGHT));
    for (let i = startIdx; i < endIdx; i++) {
      tbody.appendChild(buildRow(rows[i], i));
    }
    if (endIdx < total) {
      tbody.appendChild(spacerRow((total - endIdx) * ROW_HEIGHT));
    }
  }

  // Build the window for the tab's own *remembered* scroll position first —
  // reading el.gridContainer.scrollTop here would be 0, since the spacer
  // rows that give the table its real scrollable height don't exist yet.
  renderVisibleRows(data.scrollTop);
  el.gridContainer.scrollTop = data.scrollTop;
  el.gridContainer.scrollLeft = data.scrollLeft;

  el.gridContainer.onscroll = () => {
    data.scrollTop = el.gridContainer.scrollTop;
    data.scrollLeft = el.gridContainer.scrollLeft;
    if (el.gridContainer._rafScheduled) return;
    el.gridContainer._rafScheduled = true;
    requestAnimationFrame(() => {
      el.gridContainer._rafScheduled = false;
      renderVisibleRows();
    });
  };
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

init();
