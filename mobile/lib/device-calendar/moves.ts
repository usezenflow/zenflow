import { DEFAULT_REMINDER_CHOICES, type Session } from "@zenflow/shared";
import type { DeviceLinks } from "./plan";

const SLOT_MS = 15 * 60_000;

export interface PhoneTimes {
  startMs: number;
  endMs: number;
  /** Minutes before start of the first alarm; 0 when there is none. */
  alarmMinutes?: number;
}

/** A phone edit the server should accept as a user move (a MOVE signal). */
export interface DeviceMove {
  key: string;
  startMs: number;
  durationMinutes: number;
}

/** A phone edit of the reminder the server should store on the session. */
export interface DeviceReminder {
  key: string;
  minutes: number;
}

export interface DeviceReview {
  moves: DeviceMove[];
  reminders: DeviceReminder[];
  /** Links whose phone event is rewritten from Zenflow: the phone edit is not kept. */
  restore: Set<string>;
}

/**
 * Compares each Zenflow event on the phone with what Zenflow last wrote and
 * with the database. A phone move is kept only when the session is a
 * scheduled TASK, Zenflow has not changed it since the last write, and the
 * phone time lands on the 15-minute grid. A phone reminder is kept when it is
 * one of the choices the app offers. Anything else is rewritten from Zenflow,
 * so the database stays the source of truth.
 */
export function reviewDeviceEvents(
  links: DeviceLinks,
  phone: Record<string, PhoneTimes | null | undefined>,
  sessions: Map<string, Session>,
): DeviceReview {
  const review: DeviceReview = { moves: [], reminders: [], restore: new Set() };
  for (const [key, link] of Object.entries(links)) {
    const device = phone[link.eventId];
    // Not read this time (an error): leave the event alone.
    if (device === undefined) continue;
    // Deleted on the phone: Zenflow writes it again.
    if (device === null) {
      review.restore.add(key);
      continue;
    }
    const session = sessions.get(key);
    // Gone from the database: the sync removes the event.
    if (!session) continue;

    const alarmChanged =
      device.alarmMinutes !== undefined &&
      link.alarmMinutes !== undefined &&
      device.alarmMinutes !== link.alarmMinutes;
    if (alarmChanged) {
      if ((DEFAULT_REMINDER_CHOICES as readonly number[]).includes(device.alarmMinutes!)) {
        review.reminders.push({ key, minutes: device.alarmMinutes! });
      } else {
        review.restore.add(key);
        continue;
      }
    }

    const changed =
      device.startMs !== link.startMs ||
      (link.endMs !== undefined && device.endMs !== link.endMs);
    if (!changed) continue;

    const dbStart = session.scheduledStartTime ? Date.parse(session.scheduledStartTime) : null;
    const movable =
      session.type === "TASK" && !session.seriesId && dbStart === link.startMs;
    if (!movable) {
      review.restore.add(key);
      continue;
    }

    const startMs = Math.round(device.startMs / SLOT_MS) * SLOT_MS;
    const durationMinutes = Math.max(15, Math.round((device.endMs - device.startMs) / SLOT_MS) * 15);
    if (startMs === link.startMs && durationMinutes === session.durationMinutes) {
      review.restore.add(key);
      continue;
    }
    review.moves.push({ key, startMs, durationMinutes });
  }
  return review;
}
