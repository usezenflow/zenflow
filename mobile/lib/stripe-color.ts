import { SESSION_TONES, type SessionTone } from "@zenflow/core";

/** Left stripe colour of a row. Done uses its ink in light mode, its pale lime vanishes on paper. */
export function stripeColor(tone: SessionTone, isDark: boolean): string {
  const { base, ink } = SESSION_TONES[tone];
  return tone === "done" && !isDark ? ink.light : base;
}
