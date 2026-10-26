import { createHash } from "crypto";
import type { SessionType } from "../../generated/prisma";

/** Google event ids allow [a-v0-9]{5,}; a uuid without dashes is deterministic and valid. */
export const eventIdOf = (id: string): string =>
  id.replace(/-/g, "").toLowerCase();

const COLOR_BY_TYPE: Record<SessionType, string> = {
  TASK: "9",
  ASSIGNMENT: "11",
  EXAM: "3",
  LECTURE: "10",
  DND: "8",
};

export interface EventSession {
  id: string;
  title: string;
  type: SessionType;
  location: string | null;
  durationMinutes: number;
  deadline: Date | null;
  scheduledStartTime: Date;
  /** Null uses the user's default reminder. */
  reminderMinutes: number | null;
}

export interface EventSeries {
  id: string;
  rrule: string;
  /** ISO instants of occurrences the student deleted. */
  exdates: string[];
}

export interface EventContext {
  timezone: string;
  defaultReminderMinutes: number;
  appUrl: string;
}

export interface GoogleEventBody {
  summary: string;
  description: string;
  location?: string;
  colorId: string;
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  recurrence?: string[];
  /** One popup at the effective reminder; none for DND blocks or a reminder of 0. */
  reminders: {
    useDefault: false;
    overrides: { method: "popup"; minutes: number }[];
  };
  extendedProperties: { private: { zf: string; zfk: "s" | "r" } };
}

const toIcsUtc = (d: Date): string =>
  d
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

function dueLine(deadline: Date | null, timezone: string): string | null {
  if (!deadline) return null;
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(deadline);
  return `Due ${when}`;
}

function base(
  session: EventSession,
  ctx: EventContext,
  id: string,
  kind: "s" | "r",
): GoogleEventBody {
  const start = session.scheduledStartTime;
  const end = new Date(start.getTime() + session.durationMinutes * 60_000);
  const minutes = session.reminderMinutes ?? ctx.defaultReminderMinutes;
  const description = [dueLine(session.deadline, ctx.timezone), ctx.appUrl]
    .filter(Boolean)
    .join("\n");
  return {
    summary: session.title,
    description,
    ...(session.location ? { location: session.location } : {}),
    colorId: COLOR_BY_TYPE[session.type],
    start: { dateTime: start.toISOString(), timeZone: ctx.timezone },
    end: { dateTime: end.toISOString(), timeZone: ctx.timezone },
    reminders: {
      useDefault: false,
      overrides:
        session.type === "DND" || minutes === 0
          ? []
          : [{ method: "popup", minutes }],
    },
    extendedProperties: { private: { zf: id, zfk: kind } },
  };
}

export function sessionEvent(
  session: EventSession,
  ctx: EventContext,
): GoogleEventBody {
  return base(session, ctx, session.id, "s");
}

/** A recurring series is one Google event; `session` is its first occurrence. */
export function seriesEvent(
  session: EventSession,
  series: EventSeries,
  ctx: EventContext,
): GoogleEventBody {
  const body = base(session, ctx, series.id, "r");
  body.recurrence = [`RRULE:${series.rrule}`];
  if (series.exdates.length > 0) {
    const excluded = series.exdates
      .map((iso) => toIcsUtc(new Date(iso)))
      .sort();
    body.recurrence.push(`EXDATE:${[...new Set(excluded)].join(",")}`);
  }
  return body;
}

export function payloadHash(body: GoogleEventBody): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}
