import { describe, expect, it } from "vitest";
import { complete, emptyState, medianMinutes, merge, record } from "../palette/history";
import { decode, encode } from "../palette/payload";

describe("palette history", () => {
  const at = 1_000;
  it("learns median length rounded to 15", () => {
    const s = emptyState();
    for (const m of [100, 110, 120]) record(s, { title: "Toán", durationMinutes: m }, at);
    expect(medianMinutes(s, "toán")).toBe(105);
    expect(medianMinutes(s, "lý")).toBeUndefined();
  });
  it("completes by prefix, most used first", () => {
    const s = emptyState();
    record(s, { title: "Toán rời rạc", durationMinutes: 60, location: "P201" }, at);
    record(s, { title: "Toán cao cấp", durationMinutes: 60 }, at);
    record(s, { title: "Toán cao cấp", durationMinutes: 60 }, at);
    expect(complete(s, "toán")).toEqual(["Toán cao cấp".toLowerCase(), "Toán rời rạc".toLowerCase()]);
    expect(complete(s, "p2")).toEqual(["P201"]);
  });
  it("merges by union with max counts", () => {
    const a = emptyState();
    const b = emptyState();
    record(a, { title: "Toán", durationMinutes: 60 }, 1);
    record(b, { title: "Toán", durationMinutes: 90 }, 5);
    record(b, { title: "Toán", durationMinutes: 90 }, 6);
    record(b, { title: "Lý", durationMinutes: 30 }, 2);
    const m = merge(a, b);
    expect(m.titles["toán"]).toMatchObject({ count: 2, lastUsed: 6, minutes: [90, 90] });
    expect(Object.keys(m.titles).sort()).toEqual(["lý", "toán"]);
  });
  it("round trips the payload and ignores unknown versions", () => {
    const s = emptyState();
    record(s, { title: "Toán", durationMinutes: 60 }, 1);
    expect(decode(encode(s))).toEqual(s);
    const bad = encode(s);
    bad[0] = 99;
    expect(decode(bad)).toEqual(emptyState());
  });
});

import { record as recordUse, emptyState as fresh, topTitles } from "@/lib/palette/history";
describe("topTitles", () => {
  it("lists the most used first and skips none", () => {
    const s = fresh();
    recordUse(s, { title: "Toán", durationMinutes: 60 }, 1);
    recordUse(s, { title: "Lý", durationMinutes: 60 }, 2);
    recordUse(s, { title: "Lý", durationMinutes: 60 }, 3);
    expect(topTitles(s, 5)).toEqual(["lý", "toán"]);
    expect(topTitles(fresh())).toEqual([]);
  });
});
