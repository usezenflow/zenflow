import type { SessionWindow } from "@zenflow/shared";
import { near } from "./normalize";

/** Weekday words to getDay (0 is Sunday). */
export const DAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  cn: 0,
  mon: 1,
  monday: 1,
  t2: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  t3: 2,
  wed: 3,
  wednesday: 3,
  t4: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  t5: 4,
  fri: 5,
  friday: 5,
  t6: 5,
  sat: 6,
  saturday: 6,
  t7: 6,
};
/** The number after "thu" (spoken "thu hai", typed "thu 2") to getDay. */
export const THU: Record<string, number> = {
  2: 1,
  3: 2,
  4: 3,
  5: 4,
  6: 5,
  7: 6,
  hai: 1,
  ba: 2,
  tu: 3,
  nam: 4,
  sau: 5,
  bay: 6,
};
export const PARTS: Record<string, SessionWindow> = {
  morning: "MORNING",
  sang: "MORNING",
  afternoon: "AFTERNOON",
  chieu: "AFTERNOON",
  evening: "EVENING",
  night: "EVENING",
  toi: "EVENING",
};
/** Parts of the day that only mean something next to a clock: "12 gio trua", "10 gio dem". */
export const CLOCK_PART: Record<string, SessionWindow> = {
  ...PARTS,
  trua: "AFTERNOON",
  dem: "EVENING",
};
export const TODAY = new Set(["today", "nay", "tonight"]);
export const TOMORROW = new Set(["tomorrow", "tmr", "tmrw", "mai"]);
/** Words that only introduce a phrase, so they leave the title with it. */
export const JOIN = new Set([
  "by",
  "before",
  "due",
  "at",
  "on",
  "for",
  "trong",
  "luc",
  "truoc",
  "han",
  "ngay",
  "vao",
  "den",
  "o",
  "tai",
]);
export const AT = new Set(["at", "luc", "@", "o", "tai"]);
export const HOUR_UNIT = new Set([
  "h",
  "hr",
  "hrs",
  "hour",
  "hours",
  "gio",
  "tieng",
]);
export const MIN_UNIT = new Set([
  "ph",
  "m",
  "min",
  "mins",
  "minute",
  "minutes",
  "p",
  "phut",
]);

/** Number words, as typed or as dictation spells them; tu and lam are the southern and compound 4 and 5. */
const NUMW: Record<string, number> = {
  mot: 1,
  hai: 2,
  ba: 3,
  bon: 4,
  tu: 4,
  nam: 5,
  lam: 5,
  sau: 6,
  bay: 7,
  tam: 8,
  chin: 9,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};
/** Number words that are other words once the marks are gone. */
const AMBIGUOUS = new Set(["sau", "nam", "bay", "lam", "tu"]);
/** muoi in the north, chuc ("ba chuc") in the south. */
const TENS = new Set(["muoi", "chuc"]);

/** A number at w[i] and how many words it takes: "30", "ba", "ba muoi", "muoi lam", "hai muoi lam". */
export function num(
  w: string[],
  i: number,
  raw?: string[],
): [number, number] | null {
  const a = w[i];
  if (/^\d{1,3}([.,]5)?$/.test(a)) return [parseFloat(a.replace(",", ".")), 1];
  if (TENS.has(a)) return w[i + 1] in NUMW ? [10 + NUMW[w[i + 1]], 2] : [10, 1];
  if (!(a in NUMW)) return null;
  if (TENS.has(w[i + 1]) && NUMW[a] >= 2 && NUMW[a] <= 9)
    return w[i + 2] in NUMW
      ? [NUMW[a] * 10 + NUMW[w[i + 2]], 3]
      : [NUMW[a] * 10, 2];
  // sáu, năm, bảy, lăm and tư lose their marks to sau (after), nam, bay, lam (do) and tu; alone they count as numbers only with the marks.
  if (AMBIGUOUS.has(a) && !/[^\x00-\x7F]/.test(raw?.[i] ?? "")) return null;
  return [NUMW[a], 1];
}

/** Slang to the word the parser already knows. */
const ALIAS: Record<string, string> = {
  trc: "truoc",
  dl: "han",
  ddl: "han",
  deadline: "han",
  ngmai: "mai",
  hnay: "nay",
  tmrrw: "tmr",
  tmrow: "tmr",
  tmorrow: "tmr",
  "2moro": "tmr",
  "2morrow": "tmr",
};
const LONG = [
  "tomorrow",
  "tonight",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "morning",
  "afternoon",
  "evening",
];

/** The word the parser knows for w: slang, or a one letter typo of a long word. Short words stay exact so titles survive. */
export function canon(w: string): string {
  if (w in ALIAS) return ALIAS[w];
  if (
    w.length < 6 ||
    w in DAYS ||
    TODAY.has(w) ||
    TOMORROW.has(w) ||
    w in PARTS
  )
    return w;
  return LONG.find((l) => near(w, l)) ?? w;
}

/** "after", "from", "sau" and "tu" before a day or time make it the earliest start, not the deadline. */
const FROM1 = new Set(["after", "from", "sau", "tu", "since"]);
const FROM_N = [
  ["not", "before"],
  ["no", "sooner", "than"],
  ["no", "earlier", "than"],
  ["khong", "som", "hon"],
];
/** How many words start an earliest start phrase at w[i]; 0 when none does. */
export function fromLen(w: string[], i: number): number {
  const long = FROM_N.find((p) => p.every((x, k) => w[i + k] === x));
  return long ? long.length : FROM1.has(w[i]) ? 1 : 0;
}
/** Words that introduce a place. Vietnamese "ở" is checked on the raw word, since "o" alone is too common. */
export const PLACE = new Set(["at", "tai"]);
