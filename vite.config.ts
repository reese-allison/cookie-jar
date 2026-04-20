import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  build: {
    target: "es2020",
    sourcemap: false,
    reportCompressedSize: true,
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
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "robots.txt", "apple-touch-icon.png"],
      // Workbox can't precache uploaded jar images or procedural sounds — those
      // are runtime API responses, not build output — so we cap precache to the
      // app shell + static icons.
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/socket\.io\//, /^\/uploads\//],
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
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
      "/uploads": "http://localhost:3001",
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
      "/uploads": "http://localhost:3001",
      "/sounds": "http://localhost:3001",
      "/socket.io": {
        target: "http://localhost:3001",
        ws: true,
      },
    },
  },
});
