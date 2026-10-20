import { useSyncExternalStore } from "react";

/** Sessions hidden until the returned function is called (Undo, or a failed delete). */
export interface HideRule {
  id: string;
}

const rules = new Set<HideRule>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const l of listeners) l();
}

/** Hide one session until the returned function is called. */
export function hideSessions(rule: HideRule): () => void {
  rules.add(rule);
  emit();
  return () => {
    if (rules.delete(rule)) emit();
  };
}

export function filterHidden<T extends { id: string }>(list: T[]): T[] {
  if (rules.size === 0) return list;
  const hidden = new Set([...rules].map((r) => r.id));
  const out = list.filter((s) => !hidden.has(s.id));
  return out.length === list.length ? list : out;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-renders when the hidden set changes. */
export function useHiddenVersion(): number {
  return useSyncExternalStore(subscribe, () => version, () => version);
}
