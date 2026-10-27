import type { KV } from "../session-disk";
import type { Session } from "@zenflow/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ getPalette: vi.fn(), putPalette: vi.fn() }));
vi.mock("@/api/users", () => api);

import { complete, emptyState, medianMinutes, merge, record, seed } from "../palette/history";
import { decode, encode, PAYLOAD_VERSION } from "../palette/payload";
import { createPaletteStore } from "../palette/store";
import { syncPalette } from "../palette/sync";

describe("record and medianMinutes", () => {
  it("keys titles case-insensitively and trims", () => {
    const s = emptyState();
    record(s, { title: " Toán ", durationMinutes: 60 }, 1);
    record(s, { title: "toán", durationMinutes: 60 }, 2);
    expect(Object.keys(s.titles)).toEqual(["toán"]);
    expect(s.titles["toán"]).toMatchObject({ count: 2, lastUsed: 2 });
  });
  it("keeps only the nine newest lengths", () => {
    const s = emptyState();
    for (let i = 1; i <= 12; i++) record(s, { title: "a", durationMinutes: i * 15 }, i);
    expect(s.titles.a.minutes).toEqual([60, 75, 90, 105, 120, 135, 150, 165, 180]);
  });
  it("never moves lastUsed back", () => {
    const s = emptyState();
    record(s, { title: "a", durationMinutes: 15 }, 9);
    record(s, { title: "a", durationMinutes: 15 }, 3);
    expect(s.titles.a.lastUsed).toBe(9);
  });
  it("counts places only when given", () => {
    const s = emptyState();
    record(s, { title: "a", durationMinutes: 15 }, 1);
    record(s, { title: "a", durationMinutes: 15, location: null }, 1);
    record(s, { title: "a", durationMinutes: 15, location: "P201" }, 4);
    expect(s.places).toEqual({ P201: { count: 1, lastUsed: 4 } });
  });
  it("median is undefined when unknown, rounded to 15 with a floor of 15", () => {
    const s = emptyState();
    expect(medianMinutes(s, "a")).toBeUndefined();
    record(s, { title: "a", durationMinutes: 1 }, 1);
    expect(medianMinutes(s, "a")).toBe(15);
    for (const m of [60, 70, 80]) record(s, { title: "b", durationMinutes: m }, 1);
    expect(medianMinutes(s, "B")).toBe(75);
  });
  it("median of an even count takes the upper middle", () => {
    const s = emptyState();
    for (const m of [30, 60, 90, 120]) record(s, { title: "a", durationMinutes: m }, 1);
    expect(medianMinutes(s, "a")).toBe(90);
  });
});

describe("seed", () => {
  it("learns from sessions, none gives an empty state", () => {
    expect(seed([], 1)).toEqual(emptyState());
    const s = seed([{ title: "Toán", durationMinutes: 60, location: "P1" }, { title: "Toán", durationMinutes: 90, location: null }] as Session[], 5);
    expect(s.titles["toán"]).toMatchObject({ count: 2, lastUsed: 5 });
    expect(s.places.P1.count).toBe(1);
  });
});

describe("complete after record", () => {
  it("sees a word recorded after an earlier completion", () => {
    const s = emptyState();
    record(s, { title: "toán cao cấp", durationMinutes: 60 }, 1);
    expect(complete(s, "toán c")).toEqual(["toán cao cấp"]);
    record(s, { title: "toán cơ bản", durationMinutes: 60 }, 2);
    expect(complete(s, "toán c")).toContain("toán cơ bản");
  });
  it("returns nothing for an empty prefix", () => {
    expect(complete(emptyState(), "")).toEqual([]);
  });
  it("breaks equal counts by recency", () => {
    const s = emptyState();
    record(s, { title: "ab old", durationMinutes: 15 }, 1);
    record(s, { title: "ab new", durationMinutes: 15 }, 99);
    expect(complete(s, "ab")).toEqual(["ab new", "ab old"]);
  });
});

describe("merge", () => {
  it("is a union with the larger count and newer lastUsed", () => {
    const a = emptyState();
    const b = emptyState();
    record(a, { title: "x", durationMinutes: 30 }, 1);
    record(a, { title: "x", durationMinutes: 30 }, 2);
    record(b, { title: "x", durationMinutes: 60 }, 9);
    record(a, { title: "p", durationMinutes: 15, location: "A" }, 1);
    record(b, { title: "q", durationMinutes: 15, location: "B" }, 1);
    const m = merge(a, b);
    expect(m.titles.x).toMatchObject({ count: 2, lastUsed: 9, minutes: [30, 30] });
    expect(Object.keys(m.places).sort()).toEqual(["A", "B"]);
    expect(Object.keys(m.titles).sort()).toEqual(["p", "q", "x"]);
  });
  it("is idempotent and does not mutate its inputs", () => {
    const a = emptyState();
    record(a, { title: "x", durationMinutes: 30 }, 1);
    const copy = structuredClone(a);
    expect(merge(a, a)).toEqual(a);
    merge(a, emptyState());
    expect(a).toEqual(copy);
  });
  it("merging with empty returns the other side", () => {
    const a = emptyState();
    record(a, { title: "x", durationMinutes: 30 }, 1);
    expect(merge(a, emptyState())).toEqual(a);
    expect(merge(emptyState(), a)).toEqual(a);
  });
  it("keeps the 500 most recently used keys per table", () => {
    const a = emptyState();
    for (let i = 0; i < 600; i++) record(a, { title: `t${i}`, durationMinutes: 15 }, i);
    const m = merge(a, emptyState());
    expect(Object.keys(m.titles)).toHaveLength(500);
    expect(m.titles.t599).toBeDefined();
    expect(m.titles.t99).toBeUndefined();
  });
});

describe("payload", () => {
  it("round trips and starts with the version byte", () => {
    const s = emptyState();
    record(s, { title: "Toán đ", durationMinutes: 60, location: "Phòng 1" }, 1);
    const bytes = encode(s);
    expect(bytes[0]).toBe(PAYLOAD_VERSION);
    expect(decode(bytes)).toEqual(s);
  });
  it("reads an empty, unknown-version or corrupt blob as empty", () => {
    expect(decode(new Uint8Array())).toEqual(emptyState());
    expect(decode(new Uint8Array([99, 123, 125]))).toEqual(emptyState());
    expect(decode(new Uint8Array([PAYLOAD_VERSION, 1, 2, 3]))).toEqual(emptyState());
    expect(decode(new Uint8Array([PAYLOAD_VERSION]))).toEqual(emptyState());
  });
  it("fills a missing table", () => {
    const body = new TextEncoder().encode(JSON.stringify({ titles: { a: { count: 1, lastUsed: 1, minutes: [] } } }));
    const bytes = new Uint8Array([PAYLOAD_VERSION, ...body]);
    expect(decode(bytes).places).toEqual({});
  });
});

describe("store", () => {
  const fake = (): KV & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getString: (k) => data.get(k), set: (k, v) => void data.set(k, v), remove: (k) => void data.delete(k), getAllKeys: () => [...data.keys()] };
  };
  it("saves and loads per user", () => {
    const store = createPaletteStore(fake());
    const s = emptyState();
    record(s, { title: "a", durationMinutes: 15 }, 1);
    store.save("u1", s);
    expect(store.load("u1")).toEqual(s);
    expect(store.load("u2")).toEqual(emptyState());
  });
  it("reads corrupt storage as empty", () => {
    const kv = fake();
    kv.set("zf.palette.u1", "{not json");
    expect(createPaletteStore(kv).load("u1")).toEqual(emptyState());
  });
  it("fills missing tables from an older save", () => {
    const kv = fake();
    kv.set("zf.palette.u1", JSON.stringify({ titles: {} }));
    expect(createPaletteStore(kv).load("u1").places).toEqual({});
  });
  it("clear removes only palette keys", () => {
    const kv = fake();
    kv.set("zf.sessions.u1", "keep");
    const store = createPaletteStore(kv);
    store.save("u1", emptyState());
    store.save("u2", emptyState());
    store.clear();
    expect(kv.getAllKeys()).toEqual(["zf.sessions.u1"]);
  });
});

describe("syncPalette", () => {
  beforeEach(() => vi.resetAllMocks());
  const withTitle = (title: string, at = 1) => {
    const s = emptyState();
    record(s, { title, durationMinutes: 30 }, at);
    return s;
  };
  const conflict = Object.assign(new Error("412"), { response: { status: 412 } });

  it("pushes the local copy with tag 0 when the server has none", async () => {
    api.getPalette.mockResolvedValue(null);
    api.putPalette.mockResolvedValue("1");
    const out = await syncPalette(withTitle("a"));
    expect(api.putPalette).toHaveBeenCalledWith(expect.any(Uint8Array), "0");
    expect(out.titles.a).toBeDefined();
  });
  it("merges the server copy and pushes with its tag", async () => {
    api.getPalette.mockResolvedValue({ bytes: encode(withTitle("remote")), etag: "77" });
    api.putPalette.mockResolvedValue("78");
    const out = await syncPalette(withTitle("local"));
    expect(Object.keys(out.titles).sort()).toEqual(["local", "remote"]);
    expect(api.putPalette).toHaveBeenCalledWith(expect.any(Uint8Array), "77");
    expect(decode(api.putPalette.mock.calls[0][0])).toEqual(out);
  });
  it("refetches, merges and retries once after a 412", async () => {
    api.getPalette.mockResolvedValueOnce({ bytes: encode(withTitle("one")), etag: "1" }).mockResolvedValueOnce({ bytes: encode(withTitle("two")), etag: "2" });
    api.putPalette.mockRejectedValueOnce(conflict).mockResolvedValueOnce("3");
    const out = await syncPalette(withTitle("local"));
    expect(Object.keys(out.titles).sort()).toEqual(["local", "one", "two"]);
    expect(api.putPalette.mock.calls.map((c) => c[1])).toEqual(["1", "2"]);
  });
  it("gives up quietly after two conflicts and keeps the merged state", async () => {
    api.getPalette.mockResolvedValue({ bytes: encode(withTitle("r")), etag: "1" });
    api.putPalette.mockRejectedValue(conflict);
    const out = await syncPalette(withTitle("local"));
    expect(api.putPalette).toHaveBeenCalledTimes(2);
    expect(Object.keys(out.titles).sort()).toEqual(["local", "r"]);
  });
  it("rethrows any other failure so the caller retries next launch", async () => {
    api.getPalette.mockResolvedValue(null);
    api.putPalette.mockRejectedValue(Object.assign(new Error("boom"), { response: { status: 500 } }));
    await expect(syncPalette(withTitle("a"))).rejects.toThrow("boom");
    expect(api.putPalette).toHaveBeenCalledTimes(1);
    api.getPalette.mockRejectedValue(new Error("offline"));
    await expect(syncPalette(withTitle("a"))).rejects.toThrow("offline");
  });
  it("treats a corrupt server blob as empty", async () => {
    api.getPalette.mockResolvedValue({ bytes: new Uint8Array([99]), etag: "5" });
    api.putPalette.mockResolvedValue("6");
    const out = await syncPalette(withTitle("a"));
    expect(Object.keys(out.titles)).toEqual(["a"]);
  });
});
