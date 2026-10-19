import { RARITY_WEIGHT, SPIRITS } from "@zenflow/spirits";

/** Starts that hatch an egg. */
export const EGG_SPARKS = 5;
/** Sparks one user day can add, so the loop rewards starts across days. */
export const DAILY_SPARK_CAP = 3;
/** Starts older than this do not count toward an egg. */
export const SPARK_WINDOW_DAYS = 14;
/** Hatches without a legendary before the next roll is forced to one. */
export const PITY_HATCHES = 10;

/** Sum of rarity weights over every season one species (`docs/mobile/spirits.md`). */
export const MAX_POWER = SPIRITS.reduce(
  (sum, s) => sum + RARITY_WEIGHT[s.rarity],
  0,
);

/** Account perks by power. Keys are read by the mobile client. */
export const POWER_PERKS = [
  { key: "examRadar", power: 3 },
  { key: "smartPlans", power: 6 },
  { key: "focusMode", power: 10 },
  { key: "askZendeck", power: 14 },
  { key: "seasonCrown", power: 19 },
] as const;
