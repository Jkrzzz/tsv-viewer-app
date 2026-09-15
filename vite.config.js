import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  base: "/tsv-viewer-app/", // Required for GitHub Pages asset resolution
  build: {
    outDir: "../dist", // Places production build at root /dist
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
