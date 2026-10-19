import type { Palette, Part, SpiritId } from "./types";
/** Egg shape shared by every spirit; the body colour comes from the palette. */
export declare const EGG: readonly Part[];
export declare const ASCENDED: Record<SpiritId, readonly Part[]>;
export declare const HATCHLING: Partial<Record<SpiritId, readonly Part[]>>;
export declare const PALETTES: Record<SpiritId, Palette>;
