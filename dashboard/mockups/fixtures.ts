/**
 * Fixture rows for the dashboard mockups. Every field comes from an existing
 * column or query; the source is named on each type. Nothing here carries a
 * user id. Values are invented, deterministic and anonymous.
 */

/** Same string unions as `SchedulingModel` and `SessionEventType` in the Prisma schema. */
export type Policy = "HEURISTIC" | "LINUCB";
export type SettledEvent = "START" | "MOVE";

/** `ActiveUsersService`: one HyperLogLog per UTC day, kept 8 days. */
export interface ActiveDay {
  day: string;
  dau: number;
}

/**
 * Users grouped by `User.createdAt` week. `weeks[n]` is the share of the cohort
 * with a `ClientEvent` APP_OPEN in week n after joining; null while the week is
 * still ahead.
 */
export interface RetentionCohort {
  cohortWeek: string;
  size: number;
  weeks: (number | null)[];
}

/** Users by longest current run of consecutive UTC days with an APP_OPEN. */
export interface StreakBucket {
  days: string;
  users: number;
}

export interface Engagement {
  dau: number;
  wau: number;
  activeDays: ActiveDay[];
  retention: RetentionCohort[];
  streaks: StreakBucket[];
}

/**
 * Per primary policy, as in `backend/scripts/ab-report.ts`: `SlotProposal`
 * counts plus `SessionEvent` counts. `dragMinutes` is the mean of
 * |dragDistanceMinutes| over MOVE rows, `reward` the mean `rewardScore`.
 */
export interface PolicyQuality {
  policy: Policy;
  proposals: number;
  acceptedUnmodified: number;
  due: number;
  events: Record<SettledEvent, number>;
  dragMinutes: number;
  reward: number;
}

/** `SlotProposal` grouped by week (`date_trunc('week', timestamp)`) and policy. */
export interface WeeklyKept {
  week: string;
  policy: Policy;
  proposals: number;
  acceptedUnmodified: number;
}

export interface LearningQuality {
  policies: PolicyQuality[];
  weekly: WeeklyKept[];
}

/** Columns of `StudentProfile` a workload group can be keyed on. */
export type WorkloadDimension = "faculty" | "className" | "cohort";

/**
 * `Session.durationMinutes` summed by weekday and hour of
 * `scheduledStartTime` (Asia/Ho_Chi_Minh), for students sharing one
 * `StudentProfile` value. `minutes[weekday][hour]`, weekday 0 is Monday.
 * Groups under `MIN_GROUP` students are hidden.
 */
export interface WorkloadGroup {
  dimension: WorkloadDimension;
  value: string;
  students: number;
  minutes: number[][];
}

export const MIN_GROUP = 5;

const DAY_MS = 86_400_000;
const TODAY = Date.UTC(2026, 9, 20);

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Small deterministic generator so the mockups look the same on every load. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function buildEngagement(): Engagement {
  const r = rng(7);
  const dauSeries = [212, 226, 241, 233, 118, 96, 219, 247];
  const activeDays = dauSeries.map((dau, i) => ({
    day: iso(TODAY - (dauSeries.length - 1 - i) * DAY_MS),
    dau,
  }));
  const retention: RetentionCohort[] = Array.from({ length: 8 }, (_, c) => {
    const size = 60 + Math.round(r() * 90);
    const weeks = Array.from({ length: 6 }, (_, w): number | null => {
      if (c + w > 7) return null;
      return w === 0 ? 1 : Math.max(0.12, +(0.82 - w * 0.12 + (r() - 0.5) * 0.08).toFixed(2));
    });
    return { cohortWeek: iso(TODAY - (7 - c) * 7 * DAY_MS - 6 * DAY_MS), size, weeks };
  });
  return {
    dau: dauSeries[dauSeries.length - 1],
    wau: 418,
    activeDays,
    retention,
    streaks: [
      { days: "1", users: 126 },
      { days: "2 to 3", users: 94 },
      { days: "4 to 6", users: 61 },
      { days: "7 to 13", users: 38 },
      { days: "14 or more", users: 17 },
    ],
  };
}

function buildLearning(): LearningQuality {
  const policies: PolicyQuality[] = [
    {
      policy: "HEURISTIC",
      proposals: 1840,
      acceptedUnmodified: 1121,
      due: 1258,
      events: { START: 902, MOVE: 719 },
      dragMinutes: 74,
      reward: 0.31,
    },
    {
      policy: "LINUCB",
      proposals: 1795,
      acceptedUnmodified: 1236,
      due: 1304,
      events: { START: 1013, MOVE: 559 },
      dragMinutes: 52,
      reward: 0.42,
    },
  ];
  const r = rng(11);
  const weekly: WeeklyKept[] = [];
  for (let w = 0; w < 8; w++) {
    for (const p of policies) {
      const proposals = 200 + Math.round(r() * 60);
      const base = p.policy === "LINUCB" ? 0.6 + w * 0.012 : 0.6;
      weekly.push({
        week: iso(TODAY - (7 - w) * 7 * DAY_MS - 6 * DAY_MS),
        policy: p.policy,
        proposals,
        acceptedUnmodified: Math.round(proposals * (base + (r() - 0.5) * 0.05)),
      });
    }
  }
  return { policies, weekly };
}

/** A weekday-hour profile: lectures mid-morning and afternoon, study in the evening. */
function profile(seed: number, scale: number): number[][] {
  const r = rng(seed);
  return Array.from({ length: 7 }, (_, d) =>
    Array.from({ length: 24 }, (_, h) => {
      const lecture = d < 5 && ((h >= 7 && h <= 11) || (h >= 13 && h <= 16)) ? 1 : 0;
      const evening = h >= 19 && h <= 22 ? (d === 6 ? 0.5 : 0.8) : 0;
      const weekend = d >= 5 && h >= 9 && h <= 17 ? 0.3 : 0;
      const w = lecture + evening + weekend;
      return w === 0 ? 0 : Math.round(w * scale * (0.7 + r() * 0.6));
    }),
  );
}

const FACULTIES: [string, number][] = [
  ["Công nghệ thông tin", 148],
  ["Sư phạm", 96],
  ["Du lịch", 71],
  ["Môi trường", 54],
  ["Ngoại ngữ", 83],
  ["Luật", 3],
];
const CLASSES: [string, number][] = [
  ["CTK47A", 42],
  ["CTK47B", 39],
  ["CTK46A", 37],
  ["SPT47A", 31],
  ["DLK47A", 28],
  ["NNA46A", 6],
];
const COHORTS: [string, number][] = [
  ["Khóa 45", 88],
  ["Khóa 46", 142],
  ["Khóa 47", 179],
  ["Khóa 48", 46],
];

function groups(dimension: WorkloadDimension, rows: [string, number][], seed: number): WorkloadGroup[] {
  return rows.map(([value, students], i) => ({
    dimension,
    value,
    students,
    minutes: profile(seed + i, students * 38),
  }));
}

export const engagement = buildEngagement();
export const learning = buildLearning();
export const workload: WorkloadGroup[] = [
  ...groups("faculty", FACULTIES, 100),
  ...groups("className", CLASSES, 200),
  ...groups("cohort", COHORTS, 300),
];

export const keptRate = (p: { acceptedUnmodified: number; proposals: number }) =>
  p.proposals ? p.acceptedUnmodified / p.proposals : 0;

/** START over placed sessions whose slot has passed (`due`). */
export const startRate = (p: Pick<PolicyQuality, "events" | "due">) =>
  p.due ? p.events.START / p.due : 0;
