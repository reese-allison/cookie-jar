import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { compression } from "vite-plugin-compression2";
import { VitePWA } from "vite-plugin-pwa";

// Find the hashed Caveat 400 woff2 in the build output and inject a
// <link rel="preload"> for it into index.html. Caveat is the H1 hero / LCP
// element — preloading it eliminates the visible font-swap on first paint.
// Build-only: ctx.bundle is undefined during `vite dev` so the dev page
// keeps using the network as discovered.
function preloadCaveatPlugin(): Plugin {
  return {
    name: "preload-caveat",
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        if (!ctx.bundle) return html;
        const caveatFile = Object.keys(ctx.bundle).find((f) =>
          /caveat-latin-400-normal[.-][^/]*\.woff2$/.test(f),
        );
        if (!caveatFile) return html;
        const tag = `<link rel="preload" as="font" type="font/woff2" href="/${caveatFile}" crossorigin>`;
        return html.replace("</head>", `    ${tag}\n  </head>`);
      },
    },
  };
}

export default defineConfig({
  build: {
    target: "es2020",
    sourcemap: false,
    reportCompressedSize: true,
    // Terser yields ~3-5% smaller JS than esbuild for ~2x build time.
    // Worth it on production bundles served to many users.
    minify: "terser",
    // Don't <link rel="modulepreload"> chunks that are only reachable via
    // React.lazy(). vendor-motion (@react-spring + @use-gesture) lives
    // entirely under InRoomScreen — preloading it from the entry would
    // download it on every landing visit and defeat the code-split.
    modulePreload: {
      resolveDependencies: (_filename, deps) => deps.filter((d) => !d.includes("vendor-motion")),
    },
    rollupOptions: {
      output: {
        // Split heavy vendors into their own chunks so they cache independently
        // and download in parallel. Auth is grouped separately because it's the
        // biggest single dep that isn't drag or real-time.
        manualChunks(id) {
          if (id.includes("socket.io-client") || id.includes("engine.io-client")) {
            return "vendor-realtime";
          }
          if (id.includes("@react-spring") || id.includes("@use-gesture")) {
            return "vendor-motion";
          }
          if (id.includes("better-auth") || id.includes("better-call")) {
            return "vendor-auth";
          }
          return undefined;
        },
      },
    },
  },
  plugins: [
    react(),
    preloadCaveatPlugin(),
    // Emit pre-compressed .br and .gz next to every text asset over 1 KiB.
    // express-static-gzip on the server picks the best one for each request's
    // Accept-Encoding (br > gzip > identity). Brotli is usually 15-25% smaller
    // than gzip on JS/CSS, and pre-compressing means zero runtime CPU cost.
    compression({ algorithms: ["brotliCompress", "gzip"], threshold: 1024 }),
    VitePWA({
      registerType: "autoUpdate",
      // Defer the SW registration script so it doesn't block first paint.
      // Default ("auto") emits a synchronous inline script in <head>; with
      // "script-defer" it runs after HTML parsing instead.
      injectRegister: "script-defer",
      includeAssets: ["favicon.svg", "robots.txt", "apple-touch-icon.png"],
      // Workbox can't precache uploaded jar images or procedural sounds — those
      // are runtime API responses, not build output — so we cap precache to the
      // app shell + static icons.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Without these three, a new SW version sits in "waiting" until every
        // tab closes — so the OLD SW keeps serving cached index.html (with
        // the old CSP header) to normal reloads, and only hard-reload
        // (Cmd+Shift+R) bypasses it. The combo below makes new deploys
        // propagate on the next normal reload.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
      // Dev PWA is off by default; flip this on locally if you need to debug the SW.
      devOptions: { enabled: false },
      manifest: {
        name: "Cookie Jar",
        short_name: "Cookie Jar",
        description:
          "A real-time collaborative app where groups share a virtual jar of notes and pull them out at random.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        theme_color: "#c67b5c",
        background_color: "#fdfbf7",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          {
            src: "/pwa-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  root: ".",
  resolve: {
    alias: {
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3001",
      "/sounds": "http://localhost:3001",
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:3001",
      "/sounds": "http://localhost:3001",
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
      },
    },
  },
});
