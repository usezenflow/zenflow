import { ASCENDED, EGG, HATCHLING, PALETTES } from "./art";
import { LOCKED, LOCKED_DARK } from "./palette";
import type { Mood, Palette, Part, SpiritId, Stage } from "./types";

const TEETH = "#fffaf2";
const FLOW_STROKE_WIDTH = 24;

export type RenderOptions = {
  /** Locked silhouettes on a dark surface need lighter ink. */
  dark?: boolean;
};

/**
 * Standalone SVG for one spirit at one stage. Pure: the same input always
 * yields the same markup, so it can be snapshot-tested and passed to
 * `SvgXml` on native or inlined on web. Motion is not included.
 */
export function renderSpirit(
  id: SpiritId,
  stage: Stage,
  mood: Mood = "calm",
  { dark = false }: RenderOptions = {},
): string {
  const palette = mood === "locked" ? (dark ? LOCKED_DARK : LOCKED) : PALETTES[id];
  const body = partsFor(id, stage)
    .map((part) => renderPart(part, palette))
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${body}</svg>`;
}

function partsFor(id: SpiritId, stage: Stage): readonly Part[] {
  if (stage === "egg") return EGG;
  if (stage === "ascended") return ASCENDED[id];
  const parts = HATCHLING[id];
  if (!parts) throw new Error(`No hatchling art for ${id}`);
  return parts;
}

function renderPart(part: Part, palette: Palette): string {
  const transform = part.matrix ? ` transform="${part.matrix}"` : "";
  const paint = paintOf(part, palette);
  if (part.tag === "path") return `<path d="${part.d}"${transform} ${paint}/>`;
  return `<circle cx="${part.cx}" cy="${part.cy}" r="${part.r}"${transform} ${paint}/>`;
}

function paintOf(part: Part, palette: Palette): string {
  switch (part.role) {
    case "bs":
      return stroked(palette.b, part.strokeWidth);
    case "ss":
      return stroked(palette.s, part.strokeWidth);
    case "as":
      return stroked(palette.a, part.strokeWidth);
    case "fm":
      return `fill="none" stroke="${palette.a}" stroke-width="${part.strokeWidth ?? FLOW_STROKE_WIDTH}" stroke-linecap="round" opacity="0.9"`;
    case "t":
      return `fill="${palette.t ?? TEETH}"`;
    default:
      return `fill="${palette[part.role]}"`;
  }
}

function stroked(colour: string, width = 1): string {
  return `fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}
