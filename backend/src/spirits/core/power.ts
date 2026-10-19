import { RARITY_WEIGHT, SPIRITS } from "@zenflow/spirits";
import type { SpiritPerk } from "@zenflow/shared";
import { POWER_PERKS, PITY_HATCHES } from "./constants";

/** Power over distinct owned species. A duplicate hatch adds nothing. */
export function powerOf(spiritIds: Iterable<string>): number {
  const owned = new Set(spiritIds);
  return SPIRITS.filter((s) => owned.has(s.id)).reduce(
    (sum, s) => sum + RARITY_WEIGHT[s.rarity],
    0,
  );
}

export function perksFor(power: number): SpiritPerk[] {
  return POWER_PERKS.map((perk) => ({
    key: perk.key,
    power: perk.power,
    unlocked: power >= perk.power,
  }));
}

/** Hatches since the last legendary. `rarities` is newest first, DB enum values. */
export function hatchesSinceLegendary(rarities: readonly string[]): number {
  const index = rarities.indexOf("LEGENDARY");
  return index === -1 ? rarities.length : index;
}

export function legendaryDue(rarities: readonly string[]): boolean {
  return hatchesSinceLegendary(rarities) >= PITY_HATCHES;
}
