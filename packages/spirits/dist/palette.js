"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOCKED_DARK = exports.LOCKED = void 0;
/** Locked silhouette, from the `.locked` rules in mockups/spirits.html. */
exports.LOCKED = {
    b: "#1f1712",
    s: "#6b4426",
    h: "#1f1712",
    a: "#8a5a32",
    e: "#ffe9c7",
    t: "#ffe9c7",
    glow: "#8a5a32",
};
/** Locked silhouette on a dark surface, from `.dark .locked` in the mockup. */
exports.LOCKED_DARK = {
    ...exports.LOCKED,
    b: "#3a2d23",
    s: "#7a4f2c",
    h: "#3a2d23",
};
