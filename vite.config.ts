import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute project root for this checkout (worktree-safe — never cwd-relative). */
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [svelte()],
  root: projectRoot,
  build: {
    outDir: path.join(projectRoot, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8765",
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      $lib: path.join(projectRoot, "src/lib"),
    },
  },
});
