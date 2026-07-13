import { defineConfig } from "vite";

import { resolveSiteBase } from "./scripts/resolve-site-base";

export default defineConfig({
  base: resolveSiteBase(process.env),
  build: {
    outDir: "dist",
    assetsDir: "assets",
    target: "es2020",
    sourcemap: false,
  },
  server: {
    host: "127.0.0.1",
    port: 4173,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
  },
});
