import { useSyncExternalStore } from "react";

/** `system` follows the OS; `light` and `dark` override it. Matches mobile's theme choice. */
export type ThemeChoice = "system" | "light" | "dark";

const STORAGE_KEY = "zenflow:theme";
const query = window.matchMedia("(prefers-color-scheme: dark)");

function readStored(): ThemeChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be blocked; follow the system.
  }
  return "system";
}

let choice: ThemeChoice = readStored();
const listeners = new Set<() => void>();

function apply(animate = false) {
  const root = document.documentElement;
  const dark = choice === "dark" || (choice === "system" && query.matches);
  root.classList.toggle("dark", dark);
  if (!animate) return;
  // Colours fade for a moment, then snap back, so static transitions stay as they were.
  root.classList.add("theme-switching");
  window.setTimeout(() => root.classList.remove("theme-switching"), 250);
}

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this session.
  }
  apply(true);
  for (const listener of listeners) listener();
}

export function getTheme(): ThemeChoice {
  return choice;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current theme choice; re-renders on change. */
export function useTheme(): ThemeChoice {
  return useSyncExternalStore(subscribe, getTheme, getTheme);
}

/** Applies the stored choice and follows OS changes while on `system`. */
export function initTheme() {
  apply();
  query.addEventListener("change", () => {
    if (choice === "system") apply();
  });
}
