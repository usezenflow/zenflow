import {
  RARITY_WEIGHT,
  SPIRIT_IDS,
  SPIRITS,
  type Spirit,
  type SpiritId,
} from "@zenflow/spirits";
import type { SpiritCollectionEntry, SpiritRarity } from "@zenflow/shared";

/** Rarity order for the collection, common first. */
export const RARITY_ORDER: SpiritRarity[] = ["common", "rare", "epic", "legendary"];

/** i18n keys (`lib/i18n-vi.ts`) for each rarity tier. */
export const RARITY_LABEL: Record<SpiritRarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

/**
 * Copy for each perk the API returns, keyed by `POWER_PERKS` in the backend.
 * `title` and `description` are i18n keys (`lib/i18n-vi.ts`).
 */
export const PERK_COPY: Record<string, { title: string; description: string }> = {
  examRadar: {
    title: "Exam radar",
    description: "Zendeck spots each new exam and tells you when to start.",
  },
  smartPlans: {
    title: "Smart plans",
    description: "A ready-made study plan for every new exam and assignment, already placed in your week.",
  },
  focusMode: {
    title: "Focus mode",
    description: "Silences notifications during your study blocks.",
  },
  askZendeck: {
    title: "Ask Zendeck",
    description: "Chat to move, add or finish plans, and connect AI tools.",
  },
  seasonCrown: {
    title: "Season crown",
    description: "A season title, a profile badge and early access to the next season.",
  },
};

export function isSpiritId(id: string): id is SpiritId {
  return (SPIRIT_IDS as readonly string[]).includes(id);
}

/** Glow behind each rarity tier. Calm hues, never the warm orange used for alerts. */
export const RARITY_GLOW: Record<SpiritRarity, string> = {
  common: "#8c9a88",
  rare: "#3d8fe0",
  epic: "#5b3fe0",
  legendary: "#f0b101",
};

/** Ability name and effect keys (`lib/i18n-vi.ts`), one per season one spirit. */
export const ABILITIES: Record<SpiritId, { name: string; effect: string }> = {
  fox: {
    name: "Rescue",
    effect: "Rebuilds the plan for an overdue item before its deadline",
  },
  wolf: {
    name: "Exam pack",
    effect: "Books study before each new exam automatically",
  },
  serpent: {
    name: "Reflow",
    effect: "Reflows the rest of the week when a class moves or a plan is skipped",
  },
  stag: {
    name: "Roots",
    effect: "Keeps one chosen weekly time free for study",
  },
  owl: {
    name: "Focus guard",
    effect: "Mutes notifications during study blocks",
  },
  lynx: {
    name: "Quick capture",
    effect: "Turns a forwarded LMS link or message into a plan",
  },
  panther: {
    name: "Weekly recap",
    effect: "Sunday summary of starts and plans kept",
  },
  phoenix: {
    name: "Rebirth",
    effect: "Restores a broken streak once a month",
  },
};

/** Collection entries grouped by rarity, roster order inside each group. Empty groups are dropped. */
export function groupByRarity(
  collection: SpiritCollectionEntry[],
): { rarity: SpiritRarity; entries: { spirit: Spirit; count: number }[] }[] {
  return RARITY_ORDER.map((rarity) => ({
    rarity,
    entries: SPIRITS.filter((s) => s.rarity === rarity).map((spirit) => ({
      spirit,
      count: collection.find((c) => c.spiritId === spirit.id)?.count ?? 0,
    })),
  })).filter((group) => group.entries.length > 0);
}

/**
 * The spirit that keeps the student company: the owned spirit with the most
 * rarity weight, roster order breaking ties. There is no equip action yet.
 */
export function equippedSpiritId(collection: SpiritCollectionEntry[]): SpiritId | null {
  let best: { id: SpiritId; weight: number } | null = null;
  for (const spirit of SPIRITS) {
    const owned = collection.some((c) => c.spiritId === spirit.id && c.count > 0);
    if (!owned) continue;
    const weight = RARITY_WEIGHT[spirit.rarity];
    if (!best || weight > best.weight) best = { id: spirit.id, weight };
  }
  return best?.id ?? null;
}

/** Egg progress as a fraction in [0, 1]. */
export function eggProgress(sparks: number, sparksNeeded: number): number {
  if (sparksNeeded <= 0) return 1;
  return Math.min(1, Math.max(0, sparks / sparksNeeded));
}
