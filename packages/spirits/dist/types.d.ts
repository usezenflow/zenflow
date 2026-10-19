export declare const SPIRIT_IDS: readonly ["fox", "wolf", "serpent", "stag", "owl", "lynx", "panther", "phoenix"];
export type SpiritId = (typeof SPIRIT_IDS)[number];
/** egg, hatchling, ascended: the three evolution forms. */
export type Stage = "egg" | "hatchling" | "ascended";
/**
 * `calm` draws the spirit in its element colours. `locked` draws the same
 * shape as a warm ink silhouette, so the student sees the shape and not the colour.
 */
export type Mood = "calm" | "locked";
/**
 * Role classes from the mockup: `b` body, `s` far side, `h` highlight,
 * `a` element accent, `e` eye, `t` teeth. `bs`, `ss`, `as` are the stroked
 * variants of body, far side and accent; `fm` is the flow mark.
 */
export type Role = "b" | "s" | "h" | "a" | "e" | "t" | "bs" | "ss" | "as" | "fm";
export type Palette = {
    b: string;
    s: string;
    h: string;
    a: string;
    e: string;
    t?: string;
    glow: string;
};
type PartBase = {
    role: Role;
    /** SVG `matrix(a b c d e f)`, with every transform in the mockup baked in. */
    matrix?: string;
    strokeWidth?: number;
};
export type PathPart = PartBase & {
    tag: "path";
    d: string;
};
export type CirclePart = PartBase & {
    tag: "circle";
    cx: number;
    cy: number;
    r: number;
};
export type Part = PathPart | CirclePart;
export {};
