import { Injectable } from "@nestjs/common";
import type { PlacementChip, Session } from "@zenflow/shared";
import { type User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { SessionCrudService } from "./session-crud.service";

/** Done events a user needs before any personal chip (tier 2) appears. */
export const CHIP_EVIDENCE_MIN = 5;
/** Share of a user's Done events a bucket must hold before tier 2 names it. */
export const CHIP_BUCKET_SHARE = 0.6;

const MS_PER_MINUTE = 60_000;
const DAY_MS = 24 * 60 * MS_PER_MINUTE;
const COLD_START_COPY = "Learning your rhythm. Move it if it does not fit.";

export type PartOfDay = "morning" | "afternoon" | "evening" | "night";

/** Local wall-clock fields of an instant in the user's timezone. */
export interface LocalTime {
  date: string;
  hour: number;
  minute: number;
  /** ISO weekday, 1 (Monday) to 7 (Sunday). */
  isoDay: number;
}

const ISO_DAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(tz, f);
  }
  return f;
}

export function localTime(at: Date, tz: string): LocalTime {
  const parts = Object.fromEntries(
    formatterFor(tz)
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    isoDay: ISO_DAY[parts.weekday],
  };
}

export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

const bucketKey = (isoDay: number, hour: number): string =>
  `${isoDay >= 6 ? "weekend" : "weekday"}:${partOfDay(hour)}`;

function clock(at: Date, tz: string): string {
  const { hour, minute } = localTime(at, tz);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function weekdayName(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "long",
  }).format(at);
}

/**
 * One trust sentence explaining why a placed TASK sits where it does.
 * Returns a single chip instead of multiple tiered chips.
 */
@Injectable()
export class PlacementChipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crud: SessionCrudService,
  ) {}

  async forTask(
    task: Pick<
      Session,
      "id" | "scheduledStartTime" | "durationMinutes" | "deadline"
    >,
    user: User,
  ): Promise<PlacementChip[]> {
    if (!task.scheduledStartTime) return [];
    const tz = user.timezone;
    const start = new Date(task.scheduledStartTime);
    const end = new Date(
      start.getTime() + task.durationMinutes * MS_PER_MINUTE,
    );
    const local = localTime(start, tz);

    const day = await this.crud.list({ view: "day", date: local.date }, user);
    const others = day.sessions.filter(
      (s) => s.id !== task.id && s.scheduledStartTime && !s.skipped,
    );
    const deadline = task.deadline ? new Date(task.deadline) : null;

    // Check for clashes
    const clashes = others.some((s) => {
      const sStart = new Date(s.scheduledStartTime as string).getTime();
      const sEnd = sStart + s.durationMinutes * MS_PER_MINUTE;
      return sStart < end.getTime() && sEnd > start.getTime();
    });

    // Get personal evidence
    const personal = await this.personalChips(user, local);

    let text: string;
    let tier: PlacementChip["tier"];

    if (personal.length > 0 && personal[0].tier === 2) {
      // Tier 2: personal claim from Done events
      text = personal[0].text;
      tier = 2;
    } else if (deadline && end.getTime() <= deadline.getTime()) {
      // Tier 1: geometry fact with deadline
      const deadlineStr = `Before your ${weekdayName(deadline, tz)} ${clock(deadline, tz)} deadline`;
      const clashStr = clashes ? "" : ", no clashes";
      text = deadlineStr + clashStr;
      tier = 1;
    } else if (!clashes) {
      // Tier 1: no deadline but no clashes
      text = "No clashes";
      tier = 1;
    } else {
      // Tier 3: cold start
      text = "Mark it done so Zenflow learns when you work best.";
      tier = 3;
    }

    return [{ tier, text }];
  }

  /** Latest session ending on the block's local day before the block starts. */
  private previousSameDay(
    others: Session[],
    start: Date,
    tz: string,
  ): { title: string; end: string } | null {
    const dayOf = localTime(start, tz).date;
    let best: { title: string; end: string; endMs: number } | null = null;
    for (const s of others) {
      const sStart = new Date(s.scheduledStartTime as string);
      const sEnd = new Date(
        sStart.getTime() + s.durationMinutes * MS_PER_MINUTE,
      );
      if (
        sEnd.getTime() > start.getTime() ||
        localTime(sEnd, tz).date !== dayOf
      )
        continue;
      if (!best || sEnd.getTime() > best.endMs) {
        best = {
          title: s.title,
          end: sEnd.toISOString(),
          endMs: sEnd.getTime(),
        };
      }
    }
    return best;
  }

  private async personalChips(
    user: User,
    local: LocalTime,
  ): Promise<PlacementChip[]> {
    const rows = await this.prisma.$queryRaw<
      { isoDow: number; hour: number; n: number }[]
    >`
      SELECT (EXTRACT(ISODOW FROM (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${user.timezone}::text))::int AS "isoDow",
             EXTRACT(HOUR FROM (e."occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE ${user.timezone}::text)::int AS hour,
             count(*)::int AS n
      FROM "SessionEvent" e
      WHERE e."userId" = ${user.id}
        AND e."eventType" = 'DONE'
      GROUP BY 1, 2`;

    const buckets = new Map<string, number>();
    let total = 0;
    for (const r of rows) {
      total += r.n;
      const key = bucketKey(r.isoDow, r.hour);
      buckets.set(key, (buckets.get(key) ?? 0) + r.n);
    }

    if (total < CHIP_EVIDENCE_MIN) {
      return [
        { tier: 3, text: COLD_START_COPY },
        {
          tier: 3,
          text: `${total} of ${CHIP_EVIDENCE_MIN} done to personalise`,
        },
      ];
    }

    const key = bucketKey(local.isoDay, local.hour);
    const inBucket = buckets.get(key) ?? 0;
    if (inBucket / total < CHIP_BUCKET_SHARE) return [];

    const [group, part] = key.split(":") as ["weekday" | "weekend", PartOfDay];
    const where = group === "weekend" ? "at weekends" : "on weekdays";
    return [
      {
        tier: 2,
        text: `You finished ${inBucket} of ${total} tasks ${where} in the ${part}`,
      },
    ];
  }
}
