import { defineConfig } from "vite";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: "public",
  base: "./", // Use relative base so assets load correctly on custom subdomains
  // IMPORTANT: publicDir defaults to "<root>/public", which would resolve
  // to public/public (doesn't exist) since root is already "public" — that
  // silently dropped CNAME from every build. Point it at an absolute path
  // instead so files here (like CNAME) always get copied into dist/.
  publicDir: path.resolve(__dirname, "static-assets"),
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // Recommended by sqlite-wasm: its wasm/glue code doesn't play well with
    // Vite's dependency pre-bundling step.
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
});
