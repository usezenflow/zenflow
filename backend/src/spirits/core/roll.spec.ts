import { SPIRIT_IDS, SPIRITS } from "@zenflow/spirits";
import { rollSpirit } from "./roll";
import {
  hatchesSinceLegendary,
  legendaryDue,
  powerOf,
  perksFor,
} from "./power";

const secret = "test-secret";

describe("rollSpirit", () => {
  it("hatches the same spirit for the same student and egg", () => {
    const a = rollSpirit({ userId: "u1", eggId: "e1", secret });
    const b = rollSpirit({ userId: "u1", eggId: "e1", secret });
    expect(a.id).toBe(b.id);
  });

  it("changes the outcome with the secret", () => {
    const outcomes = new Set(
      ["a", "b", "c", "d", "e", "f", "g", "h"].map(
        (s) => rollSpirit({ userId: "u1", eggId: "e1", secret: s }).id,
      ),
    );
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it("forces a legendary when pity is due", () => {
    for (let i = 0; i < 50; i++) {
      expect(
        rollSpirit({ userId: "u", eggId: `e${i}`, secret }, true).rarity,
      ).toBe("legendary");
    }
  });

  it("hatches rarer species less often than common ones", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const id = rollSpirit({
        userId: `user-${i}`,
        eggId: `egg-${i}`,
        secret,
      }).id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const common = (counts.get("stag") ?? 0) + (counts.get("owl") ?? 0);
    const legendary = counts.get("phoenix") ?? 0;
    expect(common).toBeGreaterThan(legendary * 3);
    expect(new Set(SPIRITS.map((s) => s.id))).toEqual(new Set(SPIRIT_IDS));
  });
});

describe("power and pity", () => {
  it("counts each owned species once", () => {
    expect(powerOf(["fox", "fox", "owl"])).toBe(2 + 1);
  });

  it("reaches the season maximum with the full roster", () => {
    expect(powerOf(SPIRIT_IDS)).toBe(19);
  });

  it("unlocks perks at their thresholds", () => {
    const perks = perksFor(6);
    expect(perks.filter((p) => p.unlocked).map((p) => p.key)).toEqual([
      "examRadar",
      "smartPlans",
    ]);
  });

  it("counts hatches since the last legendary", () => {
    expect(hatchesSinceLegendary(["RARE", "COMMON", "LEGENDARY", "EPIC"])).toBe(
      2,
    );
    expect(hatchesSinceLegendary(["RARE"])).toBe(1);
    expect(hatchesSinceLegendary([])).toBe(0);
  });

  it("makes a legendary due after ten hatches without one", () => {
    expect(legendaryDue(Array(9).fill("COMMON"))).toBe(false);
    expect(legendaryDue(Array(10).fill("COMMON"))).toBe(true);
  });
});
