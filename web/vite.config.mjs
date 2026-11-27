import { defineConfig } from "vite";

const servicePort = process.env.CARTQUILT_SERVICE_PORT ?? "4173";
const service = `http://127.0.0.1:${servicePort}`;

export default defineConfig({
  publicDir: "static",
  build: {
    // The Go editor already uses /assets for project artwork.
    assetsDir: "bundles",
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "^/(?:projects/[^/]+/)?(?:api|assets)(?:/|$)": {
        target: service,
        // Preserve the browser's Host and Origin for the Go service's local request checks.
        changeOrigin: false,
      },
    },
  },
});
