import { enUS, vi } from "date-fns/locale";
import { useSyncExternalStore } from "react";
import commonTranslations from "./i18n/common";
import pwaTranslations from "./i18n/pwa";
import taskTranslations from "./i18n/task";
import vietnamese from "./i18n/vi";
import { localizeValidation } from "./i18n/validation";

export type Language = "en" | "vi";

const STORAGE_KEY = "zenflow:language";

function readStored(): Language {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "en" || stored === "vi") return stored;
  } catch {
    // Storage can be blocked; fall back to the default.
  }
  return "vi";
}

let language: Language = readStored();
const translations: Record<string, string> = {
  ...vietnamese,
  ...taskTranslations,
  ...commonTranslations,
  ...pwaTranslations,
};
const listeners = new Set<() => void>();

export function setLanguage(next: Language) {
  if (language === next) return;
  language = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this session.
  }
  document.documentElement.lang = next;
  for (const listener of listeners) listener();
}

export function getLanguage() {
  return language;
}

export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders the component when the language changes. */
export function useLanguage(): Language {
  return useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage);
}

export function locale() {
  return language === "vi" ? "vi-VN" : "en-US";
}

export function dateFnsLocale() {
  return language === "vi" ? vi : enUS;
}

/** Translate a UI string. English keys are the fallback and the source of truth. */
export function t(key: string, values?: Record<string, string | number>): string {
  const translated =
    language === "vi"
      ? (translations[key] ?? localizeValidation(key, language) ?? key)
      : key;
  return translated.replace(/\{(\w+)\}/g, (match, name: string) =>
    values?.[name] === undefined ? match : String(values[name]),
  );
}
