import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // `scripts/check-budget.mjs` needs to tell the INITIAL entry graph apart from
    // the lazy route chunks, and only the manifest records that distinction
    // (`imports` = static, `dynamicImports` = split off). Summing every file in
    // dist/assets would count all 30-odd lazy routes and make the code split look
    // like a regression. nginx serves dist/ as-is; the extra .vite/manifest.json
    // is never requested by the page.
    manifest: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      // Inside Docker the frontend reaches the API via the "backend" service
      // name. Override with BACKEND_URL for non-Docker local dev.
      "/api": {
        target: process.env.BACKEND_URL || "http://backend:8000",
        changeOrigin: true,
      },
    },
  },
});
