/// <reference types="vite-plugin-pwa/vanillajs" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.tsx";
import { initTheme } from "./lib/theme";
import { loadGeist } from "./lib/fonts";

loadGeist();
initTheme();
if (import.meta.env.PROD) registerSW({ immediate: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
