"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSpirit = renderSpirit;
const art_1 = require("./art");
const palette_1 = require("./palette");
const TEETH = "#fffaf2";
const FLOW_STROKE_WIDTH = 24;
/**
 * Standalone SVG for one spirit at one stage. Pure: the same input always
 * yields the same markup, so it can be snapshot-tested and passed to
 * `SvgXml` on native or inlined on web. Motion is not included.
 */
function renderSpirit(id, stage, mood = "calm", { dark = false } = {}) {
    const palette = mood === "locked" ? (dark ? palette_1.LOCKED_DARK : palette_1.LOCKED) : art_1.PALETTES[id];
    const body = partsFor(id, stage)
        .map((part) => renderPart(part, palette))
        .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${body}</svg>`;
}
function partsFor(id, stage) {
    if (stage === "egg")
        return art_1.EGG;
    if (stage === "ascended")
        return art_1.ASCENDED[id];
    const parts = art_1.HATCHLING[id];
    if (!parts)
        throw new Error(`No hatchling art for ${id}`);
    return parts;
}
function renderPart(part, palette) {
    const transform = part.matrix ? ` transform="${part.matrix}"` : "";
    const paint = paintOf(part, palette);
    if (part.tag === "path")
        return `<path d="${part.d}"${transform} ${paint}/>`;
    return `<circle cx="${part.cx}" cy="${part.cy}" r="${part.r}"${transform} ${paint}/>`;
}
function paintOf(part, palette) {
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
function stroked(colour, width = 1) {
    return `fill="none" stroke="${colour}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;
}
