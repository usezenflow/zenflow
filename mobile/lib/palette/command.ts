import { MAX_BULK_SESSIONS } from "@zenflow/shared";
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { t } from "@/lib/i18n";
import { understand } from "./understand";
import { fold } from "./normalize";

export type Verb =
  | "add"
  | "edit"
  | "delete"
  | "free"
  | "view"
  | "recap"
  | "replan"
  | "undo";

/** Folded words that start each verb; the first matching word (or pair) must be followed by a space or the end. */
const WORDS: [Verb, string[]][] = [
  ["edit", ["edit", "sua"]],
  ["delete", ["delete", "xoa"]],
  ["free", ["free", "ranh"]],
  ["view", ["view", "xem"]],
  ["recap", ["recap", "tong ket"]],
  ["replan", ["replan", "xep lai"]],
  ["undo", ["undo", "hoan tac"]],
];

export interface Command {
  verb: Verb;
  rest: string;
  /** Characters of the text taken by the verb word and its leading blanks; 0 for a plain add. */
  consumed: number;
}

/** Exact match on the first word(s); "add " forces a plain add so a title can start with a verb. */
export function parseCommand(text: string): Command {
  const head = fold(text.trimStart()).text;
  if (/^add(\s|$)/.test(head))
    return { verb: "add", rest: text.trimStart().slice(3).trim(), consumed: 0 };
  for (const [verb, words] of WORDS) {
    const w = words.find((x) => head === x || head.startsWith(`${x} `));
    if (w)
      return {
        verb,
        rest: text.trimStart().slice(w.length).trim(),
        consumed: text.length - text.trimStart().length + w.length,
      };
  }
  return { verb: "add", rest: text, consumed: 0 };
}

/** Verbs a command needs a range for. */
export const RANGE_VERBS: Verb[] = ["view", "recap", "replan", "free"];
/** Verbs whose first step is picking a task with `@`. */
export const TARGET_VERBS: Verb[] = ["edit", "delete"];

export type RangeId =
  | "today"
  | "tomorrow"
  | "this_week"
  | "next_week"
  | "last_week"
  | "next_7"
  | "past_7"
  | "this_month"
  | "last_month";
export const RANGE_IDS: RangeId[] = [
  "today",
  "tomorrow",
  "this_week",
  "last_week",
  "next_week",
  "next_7",
  "past_7",
  "this_month",
  "last_month",
];
export interface Range {
  from: Date;
  to: Date;
}
export const MAX_RANGE_DAYS = 366;

/** Monday first weeks, local time. */
export function rangePreset(id: RangeId, now: Date): Range {
  const day = startOfDay(now);
  const week = { weekStartsOn: 1 } as const;
  switch (id) {
    case "today":
      return { from: day, to: day };
    case "tomorrow":
      return { from: addDays(day, 1), to: addDays(day, 1) };
    case "this_week":
      return { from: startOfWeek(day, week), to: endOfWeek(day, week) };
    case "next_week":
      return {
        from: addDays(startOfWeek(day, week), 7),
        to: addDays(endOfWeek(day, week), 7),
      };
    case "last_week":
      return {
        from: addDays(startOfWeek(day, week), -7),
        to: addDays(endOfWeek(day, week), -7),
      };
    case "next_7":
      return { from: day, to: addDays(day, 6) };
    case "past_7":
      return { from: addDays(day, -6), to: day };
    case "this_month":
      return { from: startOfMonth(day), to: endOfMonth(day) };
    case "last_month":
      return {
        from: startOfMonth(addMonths(day, -1)),
        to: endOfMonth(addMonths(day, -1)),
      };
  }
}

export function checkRange(r: Range): string | null {
  if (r.to < r.from) return t("End date is before start.");
  if (differenceInCalendarDays(r.to, r.from) + 1 > MAX_RANGE_DAYS)
    return t("Range is over {n} days.", { n: MAX_RANGE_DAYS });
  return null;
}

/** One non-empty trimmed line per task: new lines, semicolons and commas and periods followed by a space (1,5h and 7 p.m. stay whole; dictation ends a task with a period), except a weekday list after a repeat. */
export const addLines = (text: string) =>
  text
    .split(/\n|;|,(?=\s)|(?<![ap]\.m)\.(?=\s|$)/)
    .map((l) => l.trim())
    .filter(Boolean)
    .reduce<string[]>((out, l) => {
      // "every mon, tue" is one repeat: a piece that adds a weekday to the repeat before it stays with it.
      const prev = out[out.length - 1];
      const now = new Date();
      const n = (x: string) => understand(x, now).repeat?.days?.length ?? 0;
      if (prev && n(`${prev} ${l}`) > n(prev)) out[out.length - 1] = `${prev} ${l}`;
      else out.push(l);
      return out;
    }, []);

export interface Context {
  cmd: Command;
  text: string;
  targets: number;
  range: Range | null;
  minutes: number | null;
}

/** The first thing wrong with a command, or null. Nothing is guessed: the user fixes it and sends again. */
export function checkCommand({
  cmd,
  text,
  targets,
  range,
  minutes,
}: Context): string | null {
  if (cmd.verb === "add") {
    if (!text.trim()) return null;
    const lines = addLines(text);
    if (!lines.length) return t("Title is empty.");
    if (lines.length > MAX_BULK_SESSIONS)
      return t("Over {n} lines.", { n: MAX_BULK_SESSIONS });
    return lines.some((l) => l.length > 60)
      ? t("Title is over 60 characters.")
      : null;
  }
  if (TARGET_VERBS.includes(cmd.verb) && !targets)
    return t("{verb} needs a task. Type @ to pick one.", { verb: cmd.verb });
  if (cmd.verb === "free" && !minutes)
    return t("free needs a duration. Pick one below.");
  if (RANGE_VERBS.includes(cmd.verb)) {
    if (!range)
      return t("{verb} needs a range. Pick one below.", { verb: cmd.verb });
    return checkRange(range);
  }
  return null;
}
