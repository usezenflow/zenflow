import { formatInTimeZone } from "date-fns-tz";

const AWAKE_FROM = 7;
const AWAKE_TO = 22;
const NEAR_DEADLINE_MS = 60 * 60_000;

/** Facts about a proposed start that an assistant should put to the user before saving. */
export function proposalWarnings(args: {
  start: Date;
  durationMinutes: number;
  deadline?: Date | null;
  timezone: string;
  overlaps?: boolean;
}): { localStart: string; warnings: string[] } {
  const { start, durationMinutes, deadline, timezone, overlaps } = args;
  const hour = Number(formatInTimeZone(start, timezone, "H"));
  const end = start.getTime() + durationMinutes * 60_000;
  const warnings: string[] = [];
  if (hour < AWAKE_FROM || hour >= AWAKE_TO)
    warnings.push("Starts outside 07:00 to 22:00.");
  if (Number(formatInTimeZone(start, timezone, "i")) >= 6)
    warnings.push("Falls on a weekend.");
  if (deadline && deadline.getTime() - end < NEAR_DEADLINE_MS)
    warnings.push("Ends within an hour of the deadline.");
  if (overlaps) warnings.push("Overlaps another session.");
  return {
    localStart: formatInTimeZone(start, timezone, "EEEE yyyy-MM-dd HH:mm"),
    warnings,
  };
}
