import type { Mood, SpiritId, Stage } from "./types";
export type RenderOptions = {
    /** Locked silhouettes on a dark surface need lighter ink. */
    dark?: boolean;
};
/**
 * Standalone SVG for one spirit at one stage. Pure: the same input always
 * yields the same markup, so it can be snapshot-tested and passed to
 * `SvgXml` on native or inlined on web. Motion is not included.
 */
export declare function renderSpirit(id: SpiritId, stage: Stage, mood?: Mood, { dark }?: RenderOptions): string;
