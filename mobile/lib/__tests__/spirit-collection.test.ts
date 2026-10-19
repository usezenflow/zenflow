import { SPIRIT_IDS } from "@zenflow/spirits";
import { describe, expect, it } from "vitest";
import {
  ABILITIES,
  eggProgress,
  equippedSpiritId,
  groupByRarity,
  isSpiritId,
} from "../spirit-collection";

const empty = SPIRIT_IDS.map((spiritId) => ({
  spiritId,
  rarity: "common" as const,
  count: 0,
}));

function owning(...ids: string[]) {
  return empty.map((entry) =>
    ids.includes(entry.spiritId) ? { ...entry, count: 1 } : entry,
  );
}

describe("spirit collection", () => {
  it("groups the roster by rarity, dropping empty tiers", () => {
    const groups = groupByRarity(empty);
    expect(groups.map((g) => g.rarity)).toEqual(["common", "rare", "epic", "legendary"]);
    expect(groups.find((g) => g.rarity === "legendary")?.entries.map((e) => e.spirit.id)).toEqual([
      "phoenix",
    ]);
  });

  it("picks the owned spirit with the most rarity weight as companion", () => {
    expect(equippedSpiritId(owning("owl", "wolf", "fox"))).toBe("wolf");
  });

  it("has no companion until something is hatched", () => {
    expect(equippedSpiritId(empty)).toBeNull();
  });

  it("breaks companion ties by roster order", () => {
    expect(equippedSpiritId(owning("fox", "serpent"))).toBe("fox");
  });

  it("gives every spirit an ability", () => {
    expect(Object.keys(ABILITIES).sort()).toEqual([...SPIRIT_IDS].sort());
  });

  it("recognises roster ids only", () => {
    expect(isSpiritId("phoenix")).toBe(true);
    expect(isSpiritId("dragon")).toBe(false);
  });

  it("clamps egg progress between zero and one", () => {
    expect(eggProgress(2, 5)).toBeCloseTo(0.4);
    expect(eggProgress(9, 5)).toBe(1);
    expect(eggProgress(0, 0)).toBe(1);
  });
});
