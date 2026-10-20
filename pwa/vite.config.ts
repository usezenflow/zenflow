import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      // Registered from main.tsx.
      injectRegister: null,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,ttf,wav,webmanifest}"],
        // Routes are code-split; this cap covers the largest precached chunk.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: "Zenflow",
        short_name: "Zenflow",
        description:
          "Zenflow is a daily planner that helps you stay organized and focused.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        theme_color: "#FEFCFA",
        background_color: "#FEFCFA",
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      // The service worker runs only in production builds.
      devOptions: {
        enabled: false,
      },
    }),
  ],
  optimizeDeps: {
    include: ["@zenflow/core", "@zenflow/shared"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@zenflow/brand": path.resolve(__dirname, "../packages/brand"),
    },
    preserveSymlinks: true,
  },
});
