import { describe, expect, it } from "vitest";
import { rankChanges } from "../palette/edits";
import { decode, encode } from "../palette/payload";
import { emptyState, merge, recordEdit } from "../palette/history";

describe("edits", () => {
  it("falls back to defaults", () => {
    expect(rankChanges(emptyState(), ["math"]).map((c) => c.id)).toEqual(["shift:1d", "later:2h", "resize:+30", "window:MORNING"]);
  });
  it("ranks a title's own history above the global count", () => {
    const s = emptyState();
    recordEdit(s, "shift:1w", ["math"], 1);
    recordEdit(s, "window:EVENING", ["gym"], 1);
    recordEdit(s, "window:EVENING", ["gym"], 2);
    expect(rankChanges(s, ["Math"])[0].id).toBe("shift:1w");
    expect(rankChanges(s, ["gym"])[0].id).toBe("window:EVENING");
  });
  it("merges and round trips; old payloads decode without edits", () => {
    const a = emptyState();
    recordEdit(a, "shift:1d", ["x"], 5);
    const b = emptyState();
    expect(merge(a, b).edits["shift:1d"].count).toBe(1);
    expect(decode(encode(a)).edits["x|shift:1d"].count).toBe(1);
    const old = new Uint8Array([1, ...new TextEncoder().encode('{"titles":{},"places":{}}')]);
    expect(decode(old).edits).toEqual({});
  });
});
