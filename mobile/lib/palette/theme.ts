import { NAV_THEME } from "@/lib/constants";

/** Colours of mockups/command-palette.html that Tailwind tokens do not cover (oklch precomputed). */
export function paletteColors(dark: boolean) {
  const orange = NAV_THEME[dark ? "dark" : "light"].primary;
  return {
    orange,
    yellow: dark ? "#F6B915" : "#F0B100",
    ink: "#2B1406",
    danger: dark ? "#FF7B72" : "#E7000B",
    success: dark ? "#4FD17E" : "#2F9A52",
    limeInk: dark ? "#D8F999" : "#4F6B14",
    dayTile: dark ? "#F26A10" : "#E65A00",
    good: dark ? "#6EE7B7" : "#2F7D4A",
    warnInk: dark ? "#FDBA74" : "#9A4A0C",
    glowTop: dark ? "rgba(255,122,36,0.26)" : "rgba(255,142,62,0.26)",
    glowMid: dark ? "rgba(246,185,21,0.10)" : "rgba(240,177,0,0.10)",
    ring: dark ? "rgba(255,122,36,0.10)" : "rgba(255,142,62,0.10)",
    edge: dark ? "rgba(255,122,36,0.30)" : "rgba(255,142,62,0.30)",
    shadow: dark ? "rgba(255,122,36,0.45)" : "rgba(255,142,62,0.45)",
  };
}

/** Highlight tints of the mockup (oklch precomputed). The tint is the colour at 20%. */
export const KIND_COLOR = {
  length: "#4FB0E3",
  clock: "#4FB0E3",
  day: "#EE5A6F",
  part: "#F0B33C",
  repeat: "#E27DB9",
  place: "#4EC585",
} as const;
export const tint = (hex: string, alpha = 0.2) =>
  `${hex}${Math.round(alpha * 255)
    .toString(16)
    .padStart(2, "0")}`;
