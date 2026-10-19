import type { SpiritPerk, SpiritsResponse } from "@zenflow/shared";
import { describe, expect, it } from "vitest";
import { heroMotivation, nextPerk, perkProgress, tierCount } from "../spirit-motivation";

const perk = (power: number, unlocked: boolean): SpiritPerk => ({ key: `p${power}`, power, unlocked });

function state(
  owned: Record<string, number>,
  egg: SpiritsResponse["egg"],
): SpiritsResponse {
  const ids = ["fox", "wolf", "owl"];
  return {
    egg,
    collection: ids.map((spiritId) => ({
      spiritId,
      rarity: "common",
      count: owned[spiritId] ?? 0,
    })),
    power: 0,
    maxPower: 19,
    perks: [],
  };
}

const incubating = { id: "e", status: "incubating" as const, sparks: 2, sparksNeeded: 5 };
const ready = { id: "e", status: "ready" as const, sparks: 5, sparksNeeded: 5 };

describe("heroMotivation", () => {
  it("asks for a hatch when the egg is ready", () => {
    expect(heroMotivation(state({ fox: 1 }, ready)).key).toBe("Your egg is ready. Hatch it now.");
  });

  it("counts the starts still needed for the next spirit", () => {
    expect(heroMotivation(state({ fox: 1 }, incubating))).toEqual({
      key: "{count} more starts until your next spirit",
      values: { count: 3 },
    });
  });

  it("invites a first start when nothing is owned", () => {
    expect(heroMotivation(state({}, incubating)).key).toBe(
      "Start a study block to hatch your first spirit.",
    );
  });

  it("celebrates a full collection", () => {
    expect(heroMotivation(state({ fox: 1, wolf: 1, owl: 2 }, incubating)).key).toBe(
      "Full collection. Legends are watching.",
    );
  });
});

describe("perks", () => {
  it("finds the first locked perk", () => {
    expect(nextPerk([perk(3, true), perk(6, false), perk(10, false)])?.power).toBe(6);
    expect(nextPerk([perk(3, true)])).toBeNull();
  });

  it("clamps progress toward a threshold", () => {
    expect(perkProgress(perk(6, false), 3)).toBeCloseTo(0.5);
    expect(perkProgress(perk(6, false), 9)).toBe(1);
  });

  it("counts owned and total per tier", () => {
    const s = state({ fox: 1 }, incubating);
    expect(tierCount(s.collection, "common")).toEqual({ owned: 1, total: 3 });
    expect(tierCount(s.collection, "legendary")).toEqual({ owned: 0, total: 0 });
  });
});
