import type { SpiritCollectionEntry, SpiritPerk, SpiritsResponse } from "@zenflow/shared";

/** An i18n key and its values, resolved with `t()` at render time. */
export type Motivation = { key: string; values?: Record<string, string | number> };

/** The headline under the egg: what the student should do next, or what they have earned. */
export function heroMotivation(data: SpiritsResponse): Motivation {
  const owned = data.collection.filter((c) => c.count > 0).length;
  if (data.egg.status === "ready") return { key: "Your egg is ready. Hatch it now." };
  if (owned === data.collection.length) return { key: "Full collection. Legends are watching." };
  if (owned === 0) return { key: "Start a study block to hatch your first spirit." };
  return {
    key: "{count} more starts until your next spirit",
    values: { count: data.egg.sparksNeeded - data.egg.sparks },
  };
}

/** The first perk still locked, in threshold order. */
export function nextPerk(perks: SpiritPerk[]): SpiritPerk | null {
  return perks.find((p) => !p.unlocked) ?? null;
}

/** Share of a perk threshold already reached, from 0 to 1. */
export function perkProgress(perk: SpiritPerk, power: number): number {
  if (perk.power <= 0) return 1;
  return Math.min(1, Math.max(0, power / perk.power));
}

/** Owned and total counts for one rarity tier of the collection. */
export function tierCount(
  collection: SpiritCollectionEntry[],
  rarity: SpiritCollectionEntry["rarity"],
): { owned: number; total: number } {
  const tier = collection.filter((c) => c.rarity === rarity);
  return { owned: tier.filter((c) => c.count > 0).length, total: tier.length };
}
