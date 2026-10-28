import type { Session } from "@zenflow/shared";
import { formatInTimeZone } from "date-fns-tz";
import { minutesToUtc } from "../common/utils";

const MIN = 60_000;
const HOUR = 60 * MIN;
const AWAKE = { from: 7, to: 22 } as const;
const MEAL = { from: 11, to: 13.5, minFree: 45 } as const;
const HEAVY_EVENING_MINUTES = 180;

type Interval = [number, number];

/** Dates from `from` to `to` inclusive, as `YYYY-MM-DD`. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 24 * HOUR
  )
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

const overlap = (a: Interval, b: Interval) =>
  Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));

function merge(intervals: Interval[]): Interval[] {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Free gaps of `window` not covered by the merged `busy` intervals. */
function freeIn(busy: Interval[], window: Interval): Interval[] {
  const out: Interval[] = [];
  let cursor = window[0];
  for (const [s, e] of busy) {
    if (e <= cursor) continue;
    if (s >= window[1]) break;
    if (s > cursor) out.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (cursor < window[1]) out.push([cursor, window[1]]);
  return out;
}

const minutes = (iv: Interval[]) =>
  Math.round(iv.reduce((n, [s, e]) => n + (e - s), 0) / MIN);

interface Placed {
  s: Session;
  iv: Interval;
}

function placed(sessions: Session[]): Placed[] {
  return sessions
    .filter((s) => s.scheduledStartTime)
    .map((s) => {
      const start = Date.parse(s.scheduledStartTime as string);
      return { s, iv: [start, start + s.durationMinutes * MIN] as Interval };
    });
}

/**
 * Plain aggregates over a schedule, for the assistant to chart and narrate.
 * Every number is computed here so the assistant does no arithmetic.
 */
export function buildRecap(
  sessions: Session[],
  from: string,
  to: string,
  timezone: string,
  rhythmMatrix: readonly number[] = [],
) {
  const items = placed(sessions);
  const hourHeat = Array.from({ length: 7 }, () =>
    new Array<number>(24).fill(0),
  );
  const hoursByType: Record<string, number> = {};
  const meallessDays: string[] = [];
  const heavyEvenings: string[] = [];
  let sawSleepBlock = false;

  const days = dateRange(from, to).map((date) => {
    const dayStart = minutesToUtc(date, 0, timezone).getTime();
    const at = (h: number) => dayStart + h * HOUR;
    const day: Interval = [dayStart, at(24)];
    const today = items
      .map((p) => ({
        ...p,
        clip: [
          Math.max(p.iv[0], day[0]),
          Math.min(p.iv[1], day[1]),
        ] as Interval,
      }))
      .filter((p) => p.clip[1] > p.clip[0]);

    const minutesByType: Record<string, number> = {};
    for (const p of today) {
      const m = Math.round((p.clip[1] - p.clip[0]) / MIN);
      minutesByType[p.s.type] = (minutesByType[p.s.type] ?? 0) + m;
      hoursByType[p.s.type] = (hoursByType[p.s.type] ?? 0) + m / 60;
    }

    const busy = merge(today.map((p) => p.clip));
    const weekday = Number(formatInTimeZone(at(12), timezone, "i")) - 1;
    for (let h = 0; h < 24; h++)
      hourHeat[weekday][h] += minutes(
        busy
          .map(
            (b) =>
              [Math.max(b[0], at(h)), Math.min(b[1], at(h + 1))] as Interval,
          )
          .filter((b) => b[1] > b[0]),
      );

    const free = freeIn(busy, [at(AWAKE.from), at(AWAKE.to)]);
    const meal = freeIn(busy, [at(MEAL.from), at(MEAL.to)]);
    if (!meal.some(([s, e]) => e - s >= MEAL.minFree * MIN))
      meallessDays.push(date);
    if (
      minutes(
        busy
          .map(
            (b) => [Math.max(b[0], at(18)), Math.min(b[1], at(22))] as Interval,
          )
          .filter((b) => b[1] > b[0]),
      ) > HEAVY_EVENING_MINUTES
    )
      heavyEvenings.push(date);
    if (
      today.some(
        (p) => p.s.type === "DND" && overlap(p.clip, [at(0), at(5)]) > 0,
      )
    )
      sawSleepBlock = true;

    const first = today.length
      ? Math.min(...today.map((p) => p.clip[0]))
      : null;
    const last = today.length ? Math.max(...today.map((p) => p.clip[1])) : null;
    const local = (t: number | null) =>
      t === null ? null : formatInTimeZone(t, timezone, "HH:mm");
    return {
      date,
      weekday: formatInTimeZone(at(12), timezone, "EEEE"),
      minutesByType,
      busyMinutes: minutes(busy),
      freeMinutes: minutes(free),
      longestFreeBlockMinutes: Math.round(
        Math.max(0, ...free.map(([s, e]) => e - s)) / MIN,
      ),
      firstStart: local(first),
      lastEnd: local(last),
    };
  });

  const deadlines = sessions
    .filter((s) => s.type === "TASK" && s.deadline)
    .map((s) => {
      const end = s.scheduledStartTime
        ? Date.parse(s.scheduledStartTime) + s.durationMinutes * MIN
        : null;
      return {
        title: s.title,
        deadline: s.deadline,
        placed: end !== null,
        slackMinutes:
          end === null
            ? null
            : Math.round((Date.parse(s.deadline as string) - end) / MIN),
      };
    });

  const totalBusy = days.reduce((n, d) => n + d.busyMinutes, 0);
  const byLoad = [...days].sort((a, b) => b.busyMinutes - a.busyMinutes);
  const busiest = byLoad[0];
  const lightest = byLoad[byLoad.length - 1];

  const insights: string[] = [];
  if (busiest && totalBusy > 0 && days.length > 1)
    insights.push(
      `${busiest.weekday} ${busiest.date} holds ${Math.round((busiest.busyMinutes / totalBusy) * 100)}% of the busy time.`,
    );
  if (meallessDays.length)
    insights.push(`No lunch break on ${meallessDays.length} day(s).`);
  const unplaced = deadlines.filter((d) => !d.placed).length;
  if (unplaced) insights.push(`${unplaced} task(s) have no time yet.`);

  const hours =
    rhythmMatrix.length === 168
      ? Array.from({ length: 24 }, (_, h) => ({
          h,
          v: Array.from(
            { length: 7 },
            (_, d) => rhythmMatrix[d * 24 + h],
          ).reduce((a, b) => a + b, 0),
        }))
          .sort((a, b) => b.v - a.v)
          .slice(0, 3)
          .map((x) => x.h)
          .sort((a, b) => a - b)
      : null;

  return {
    timezone,
    days,
    hourHeat,
    deadlines,
    totals: {
      hoursByType: Object.fromEntries(
        Object.entries(hoursByType).map(([k, v]) => [
          k,
          Math.round(v * 10) / 10,
        ]),
      ),
      busiestDay: busiest
        ? { date: busiest.date, busyMinutes: busiest.busyMinutes }
        : null,
      lightestDay: lightest
        ? { date: lightest.date, busyMinutes: lightest.busyMinutes }
        : null,
      unplacedTasks: unplaced,
    },
    gaps: {
      daysWithoutLunchBreak: meallessDays,
      heavyEvenings,
      hasOvernightDnd: sawSleepBlock,
    },
    insights,
    // Present only once the user's habits have been learned, so the assistant never claims a rhythm that is not there.
    rhythm: hours ? { bestStartHours: hours } : undefined,
  };
}

/** Free slots of at least `durationMinutes` between 07:00 and 22:00, earliest first. */
export function findFreeSlots(
  sessions: Session[],
  from: string,
  to: string,
  durationMinutes: number,
  timezone: string,
  limit = 20,
) {
  const busy = merge(placed(sessions).map((p) => p.iv));
  const slots: { start: string; end: string; freeMinutes: number }[] = [];
  for (const date of dateRange(from, to)) {
    const at = (h: number) =>
      minutesToUtc(date, 0, timezone).getTime() + h * HOUR;
    for (const [s, e] of freeIn(busy, [at(AWAKE.from), at(AWAKE.to)])) {
      if (e - s < durationMinutes * MIN) continue;
      slots.push({
        start: formatInTimeZone(s, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        end: formatInTimeZone(e, timezone, "yyyy-MM-dd'T'HH:mm:ssXXX"),
        freeMinutes: Math.round((e - s) / MIN),
      });
    }
  }
  return slots.slice(0, limit);
}
