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
export const SPIRITS: readonly Spirit[] = [
  { id: "fox", no: "001", vi: "Cửu vĩ hồ", en: "Flame fox", element: "Hỏa", rarity: "rare" },
  { id: "wolf", no: "002", vi: "Phong lang", en: "Storm wolf", element: "Phong", rarity: "epic" },
  { id: "serpent", no: "003", vi: "Thủy xà", en: "Tide serpent", element: "Thủy", rarity: "rare" },
  { id: "stag", no: "004", vi: "Mộc lộc", en: "Thorn stag", element: "Mộc", rarity: "common" },
  { id: "owl", no: "005", vi: "Băng cú", en: "Frost owl", element: "Băng", rarity: "common" },
  { id: "lynx", no: "006", vi: "Lôi miêu", en: "Volt lynx", element: "Lôi", rarity: "rare" },
  { id: "panther", no: "007", vi: "Ảnh báo", en: "Umbra panther", element: "Ảnh", rarity: "epic" },
  { id: "phoenix", no: "008", vi: "Nhật phượng", en: "Sunrise phoenix", element: "Nhật", rarity: "legendary" },
];

/** Rarity weights from docs/mobile/spirits.md. Power is their sum over owned spirits. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 1,
  rare: 2,
  epic: 3,
  legendary: 5,
};
