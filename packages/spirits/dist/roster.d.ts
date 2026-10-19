import type { SpiritId } from "./types";
export type Rarity = "common" | "rare" | "epic" | "legendary";
export type Spirit = {
    id: SpiritId;
    no: string;
    vi: string;
    en: string;
    element: string;
    rarity: Rarity;
};
/** Season one roster, in the order of docs/mobile/spirits.md. */
export declare const SPIRITS: readonly Spirit[];
/** Rarity weights from docs/mobile/spirits.md. Power is their sum over owned spirits. */
export declare const RARITY_WEIGHT: Record<Rarity, number>;
