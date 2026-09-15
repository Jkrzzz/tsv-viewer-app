import { defineConfig } from "vite";

export default defineConfig({
  root: "public",
  base: "/YOUR-REPOSITORY-NAME/",
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
