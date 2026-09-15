import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  base: "/", // Changed from "/tsv-viewer-app/" for custom subdomain root
  build: {
    outDir: "../dist",
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
