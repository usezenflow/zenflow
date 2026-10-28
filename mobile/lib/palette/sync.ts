import { getPalette, putPalette } from "@/api/users";
import { decode, encode } from "./payload";
import { merge, type PaletteState } from "./history";

/** Pulls the server copy, merges it in and pushes the union. One retry on a stale tag. */
export async function syncPalette(local: PaletteState): Promise<PaletteState> {
  let state = local;
  for (let i = 0; i < 2; i++) {
    const remote = await getPalette();
    if (remote) state = merge(state, decode(remote.bytes));
    try {
      await putPalette(encode(state), remote?.etag ?? "0");
      return state;
    } catch (e) {
      if ((e as { response?: { status?: number } }).response?.status !== 412)
        throw e;
    }
  }
  return state;
}
