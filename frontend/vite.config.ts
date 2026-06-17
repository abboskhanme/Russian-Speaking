import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
