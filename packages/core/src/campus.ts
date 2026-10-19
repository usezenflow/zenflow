/**
 * Campus places from `coords.json`, normalised: comma decimals, Cyrillic
 * lookalikes in codes and a misspelt header are fixed here. Towers are keyed
 * by their code (`A8`).
 */
export type CampusPlaceKind = "TOWER" | "GATE" | "PARKING" | "FACILITY" | "SPORTS";

export interface CampusPlace {
  kind: CampusPlaceKind;
  name: string;
  lat: number;
  lng: number;
}

export interface CampusSuggestion {
  place: CampusPlace;
  /** What the location field stores when this suggestion is picked. */
  value: string;
}

/** Table order is search order: A8 leads, then gates and facilities, then towers. */
export const CAMPUS_PLACES: readonly CampusPlace[] = [
  { kind: "TOWER", name: "A8", lat: 11.95571296, lng: 108.4468659 },
  { kind: "GATE", name: "Công sau", lat: 11.95784143, lng: 108.4433524 },
  { kind: "FACILITY", name: "Thư viện", lat: 11.95714258, lng: 108.4449201 },
  { kind: "SPORTS", name: "Sân thể chất", lat: 11.95626647, lng: 108.4476812 },
  { kind: "FACILITY", name: "Hội trường thống nhất", lat: 11.95592909, lng: 108.4443694 },
  { kind: "FACILITY", name: "Sân khấu ngoài trời", lat: 11.95467388, lng: 108.4456087 },
  {
    kind: "FACILITY",
    name: "Trung tâm Giáo dục Đào tạo Trí tuệ Nhân Tạo",
    lat: 11.95578577,
    lng: 108.4438786,
  },
  { kind: "PARKING", name: "Nhà giữ xe công trước", lat: 11.95386457, lng: 108.4449788 },
  { kind: "TOWER", name: "A1", lat: 11.95448879, lng: 108.4443214 },
  { kind: "TOWER", name: "A2", lat: 11.95520588, lng: 108.444411 },
  { kind: "TOWER", name: "A3", lat: 11.95540784, lng: 108.4439199 },
  { kind: "TOWER", name: "A4", lat: 11.95488764, lng: 108.4433536 },
  { kind: "TOWER", name: "A5", lat: 11.95579903, lng: 108.4435479 },
  { kind: "TOWER", name: "A7", lat: 11.95592664, lng: 108.4464877 },
  { kind: "TOWER", name: "A11", lat: 11.95578926, lng: 108.4475997 },
  { kind: "TOWER", name: "A16", lat: 11.95661216, lng: 108.4468293 },
  { kind: "TOWER", name: "A18", lat: 11.95633225, lng: 108.4460691 },
  { kind: "TOWER", name: "A19", lat: 11.95688763, lng: 108.4460549 },
  { kind: "TOWER", name: "A20", lat: 11.95720479, lng: 108.44633 },
  { kind: "TOWER", name: "A21", lat: 11.95671696, lng: 108.4455134 },
  { kind: "TOWER", name: "A24", lat: 11.95663806, lng: 108.444549 },
  { kind: "TOWER", name: "A25", lat: 11.95659325, lng: 108.4438999 },
  { kind: "TOWER", name: "A27", lat: 11.95563795, lng: 108.4432633 },
  { kind: "TOWER", name: "A30", lat: 11.95657931, lng: 108.4431519 },
  { kind: "TOWER", name: "A31", lat: 11.95787168, lng: 108.4441701 },
  { kind: "TOWER", name: "A32", lat: 11.95791843, lng: 108.44584 },
];

const CYRILLIC_LOOKALIKES: Record<string, string> = {
  "А": "A",
  "З": "3",
  "Е": "E",
  "О": "O",
  "С": "C",
  "Р": "P",
  "Т": "T",
  "М": "M",
  "Н": "H",
  "В": "B",
  "К": "K",
  "Х": "X",
};

/** Lowercase, accent-free, Latin letters, single spaces. Every match runs on this form. */
export function foldCampusText(text: string): string {
  return text
    .replace(/[АЗЕОСРТМНВКХ]/g, (c) => CYRILLIC_LOOKALIKES[c] ?? c)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const FOLDED = CAMPUS_PLACES.map((place) => foldCampusText(place.name));
const SPORTS_INDEX = CAMPUS_PLACES.findIndex((place) => place.kind === "SPORTS");

/** Timetable rooms for the sports ground: `SAN01`, `SAN 1`, `san-01`. */
const SPORTS_CODE = /^san[ .-]*(\d+)/;
/** Tower rooms: `A8`, `A8-101`, `A 27 201`, `Tòa A8`. */
const TOWER_CODE = /^(?:toa )?a ?(\d{1,2})(?!\d)/;

function indexOfFolded(folded: string): number {
  return FOLDED.indexOf(folded);
}

/** The place a stored location means, or `null` for a free-text room or a link. */
export function resolveCampusPlace(location: string): CampusPlace | null {
  const text = foldCampusText(location);
  const tower = TOWER_CODE.exec(text);
  if (tower) {
    const index = indexOfFolded(`a${Number(tower[1])}`);
    return index === -1 ? null : CAMPUS_PLACES[index];
  }
  if (SPORTS_CODE.test(text)) return CAMPUS_PLACES[SPORTS_INDEX];
  const index = indexOfFolded(text);
  return index === -1 ? null : CAMPUS_PLACES[index];
}

function matchRank(folded: string, query: string): number | null {
  if (folded === query) return 0;
  if (folded.startsWith(query)) return 1;
  if (folded.split(" ").some((word) => word.startsWith(query))) return 2;
  return null;
}

/**
 * Suggestions for the location field, best first. An empty query returns the
 * leading places in table order. `SAN01` leads with the sports ground and
 * keeps the typed code as its value.
 */
export function searchCampusPlaces(query: string, limit = 6): CampusSuggestion[] {
  const q = foldCampusText(query);
  if (!q) return CAMPUS_PLACES.slice(0, limit).map((place) => ({ place, value: place.name }));

  const hits: { rank: number; index: number; suggestion: CampusSuggestion }[] = [];
  const sports = SPORTS_CODE.exec(q);
  if (sports) {
    hits.push({
      rank: -1,
      index: SPORTS_INDEX,
      suggestion: { place: CAMPUS_PLACES[SPORTS_INDEX], value: `SAN${sports[1]}` },
    });
  }
  CAMPUS_PLACES.forEach((place, index) => {
    const rank = matchRank(FOLDED[index], q);
    if (rank !== null) hits.push({ rank, index, suggestion: { place, value: place.name } });
  });
  return hits
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((hit) => hit.suggestion);
}
