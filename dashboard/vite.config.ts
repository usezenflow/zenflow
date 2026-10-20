import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5174 },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectRegister: null,
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,ttf,webmanifest}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      manifest: {
        name: "Zenflow dashboard",
        short_name: "Dashboard",
        description: "Aggregate engagement, learning quality and workload.",
        theme_color: "#ffffff",
        icons: [{ src: "logo.svg", sizes: "192x192", type: "image/svg+xml" }],
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@mockups": path.resolve(__dirname, "./mockups"),
      "@zenflow/brand": path.resolve(__dirname, "../packages/brand"),
    },
    preserveSymlinks: true,
  },
});
