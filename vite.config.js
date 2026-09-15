import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  base: "./", // Use relative base so assets load correctly on custom subdomains
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
