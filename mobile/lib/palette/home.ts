import type { Session } from "@zenflow/shared";
import { t } from "@/lib/i18n";

export interface Suggestion {
  id: string;
  /** Typed into the field when the chip is tapped, or the label of a verb chip. */
  text: string;
  /** A chip that starts a command instead of typing an example. */
  verb?: "replan" | "recap" | "free";
}

export const MAX_AGAIN = 3;
const MAX_CHIPS = 8;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** Ready to send lines that show what the field understands. */
const starters = (): Omit<Suggestion, "id">[] => [
  { text: t("Group project at library by fri") },
  { text: t("Replan my week"), verb: "replan" },
  { text: t("Essay 2h after wed by sun") },
  { text: t("Recap my week"), verb: "recap" },
  { text: t("Gym 1h tomorrow morning") },
  { text: t("Find free time"), verb: "free" },
  { text: t("Call mom 7pm tomorrow") },
  { text: t("Read 45m evening") },
  { text: t("Study 2h tonight") },
];

/**
 * Chips for an empty field: what the user did on this weekday last week, then fixed starters.
 */
export function homeSuggestions(input: {
  lastWeek?: Session[] | null;
  today?: Session[] | null;
  now: Date;
}): Suggestion[] {
  const { lastWeek, today, now } = input;
  const out: Suggestion[] = [];
  const have = new Set((today ?? []).map((s) => s.title.trim().toLowerCase()));
  const seen = new Set<string>();
  const week = 7 * 86_400_000;
  for (const s of lastWeek ?? []) {
    if (out.length >= MAX_AGAIN) break;
    const key = s.title.trim().toLowerCase();
    if (
      s.type !== "TASK" ||
      !s.scheduledStartTime ||
      !key ||
      have.has(key) ||
      seen.has(key)
    )
      continue;
    if (
      !sameDay(new Date(new Date(s.scheduledStartTime).getTime() + week), now)
    )
      continue;
    seen.add(key);
    out.push({ id: `again:${s.id}`, text: s.title });
  }
  for (const st of starters().slice(0, MAX_CHIPS - out.length))
    out.push({ id: `starter:${st.text}`, ...st });
  return out;
}
