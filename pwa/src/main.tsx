/// <reference types="vite-plugin-pwa/vanillajs" />
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./index.css";
import App from "./App.tsx";
import { initTheme } from "./lib/theme";
import { loadGeist } from "./lib/fonts";
import { getLanguage } from "./lib/i18n";
import { startPushSync } from "./lib/push/sync";

loadGeist();
initTheme();
document.documentElement.lang = getLanguage();
if (import.meta.env.PROD) registerSW({ immediate: true });
startPushSync();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
