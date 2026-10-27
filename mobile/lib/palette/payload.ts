import { emptyState, type PaletteState } from "./history";

/** Byte 0 is the format version; the rest is JSON. The server stores it opaque. */
export const PAYLOAD_VERSION = 1;

export function encode(state: PaletteState): Uint8Array {
  const body = new TextEncoder().encode(JSON.stringify(state));
  const out = new Uint8Array(body.length + 1);
  out[0] = PAYLOAD_VERSION;
  out.set(body, 1);
  return out;
}

/** An unknown version or corrupt bytes read as empty rather than crashing. */
export function decode(bytes: Uint8Array): PaletteState {
  if (bytes[0] !== PAYLOAD_VERSION) return emptyState();
  try {
    const s = JSON.parse(new TextDecoder().decode(bytes.subarray(1)));
    return {
      titles: s.titles ?? {},
      places: s.places ?? {},
      edits: s.edits ?? {},
    };
  } catch {
    return emptyState();
  }
}
