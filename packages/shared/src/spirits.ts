/** A spirit's rarity, lowercase as in `@zenflow/spirits`. */
export type SpiritRarity = "common" | "rare" | "epic" | "legendary";

/** The egg a student is incubating. `ready` once `sparks` reaches `sparksNeeded`. */
export interface SpiritEgg {
  id: string;
  status: "incubating" | "ready";
  sparks: number;
  sparksNeeded: number;
}

/** One season one species. `count` is 0 until it is hatched. */
export interface SpiritCollectionEntry {
  spiritId: string;
  rarity: SpiritRarity;
  count: number;
}

/** A power milestone (`docs/mobile/spirits.md`). `unlocked` once power reaches `power`. */
export interface SpiritPerk {
  key: string;
  power: number;
  unlocked: boolean;
}

/** `data` of `GET /spirits`. */
export interface SpiritsResponse {
  egg: SpiritEgg;
  collection: SpiritCollectionEntry[];
  /** Sum of rarity weights over distinct owned species. */
  power: number;
  maxPower: number;
  perks: SpiritPerk[];
}

/** `data` of `POST /eggs/:id/hatch`. */
export interface SpiritHatchResponse {
  spirit: { spiritId: string; rarity: SpiritRarity };
  /** The next egg, now incubating. */
  egg: SpiritEgg;
  power: number;
}
