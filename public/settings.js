const DEFAULT_SETTINGS = {
  expandSubfoldersOnOpen: false,
  sidebarWidth: "260px",
  recentFoldersCollapsed: true,
  maxFileBytes: 25 * 1024 * 1024,
};

export const settings = {
  data: { ...DEFAULT_SETTINGS },

  load() {
    const saved = localStorage.getItem("tsvViewer.settings");
    if (saved) {
      try {
        this.data = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch (e) {
        console.error("Failed to parse saved settings", e);
      }
    }
  },

  save() {
    localStorage.setItem("tsvViewer.settings", JSON.stringify(this.data));
  },

  get(key) {
    return this.data[key];
  },

  set(key, value) {
    this.data[key] = value;
    this.save();
  },
};

// Load settings immediately on script load
settings.load();
