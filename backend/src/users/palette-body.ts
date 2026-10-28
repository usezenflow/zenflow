import { raw } from "express";
import { PALETTE_MAX_BYTES } from "./palette.service";

/** Raw bytes for the palette route; a body over the limit answers 413. */
export const paletteBodyParser = () =>
  raw({ type: "application/octet-stream", limit: PALETTE_MAX_BYTES });
