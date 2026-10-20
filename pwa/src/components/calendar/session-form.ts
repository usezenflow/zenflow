import type { LocationValue } from "@/lib/places/location";
import { snap } from "@/utils/snap";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";
import { hhmmToMinutes } from "@zenflow/core";
import type { CreateSessionInput, Session, UpdateSessionInput } from "@zenflow/shared";
import { format } from "date-fns";

export const SESSION_TYPES = ["TASK", "ASSIGNMENT", "EXAM", "LECTURE", "DND"] as const;
export type SessionType = (typeof SESSION_TYPES)[number];

/** The editor's values. A saved session and a draft both read and write this shape. */
export interface SessionForm {
  type: SessionType;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  duration: number;
  deadline: string;
  place: LocationValue;
  reminders: number[];
  tags: string;
  note: string;
}

/** Default lead time for a new plan, from the user's settings. */
export const DRAFT_DURATION = 60;

const pad = (n: number) => String(n).padStart(2, "0");

/** The place picker's value, read from a saved session's location columns. */
function placeFromSession(session: Session): LocationValue {
  return {
    text: session.location ?? "",
    point:
      session.locationLat != null && session.locationLng != null
        ? { lat: session.locationLat, lng: session.locationLng }
        : null,
    origin: session.originLocation ?? "",
    originPoint:
      session.originLat != null && session.originLng != null
        ? { lat: session.originLat, lng: session.originLng }
        : null,
    commuteMinutes: session.commuteMinutes,
  };
}

/** The session columns a place picker value writes. */
export function placeToSession(place: LocationValue) {
  const origin = place.origin.trim() || null;
  return {
    location: place.text.trim() || null,
    locationLat: place.point?.lat ?? null,
    locationLng: place.point?.lng ?? null,
    originLocation: origin,
    originLat: origin ? (place.originPoint?.lat ?? null) : null,
    originLng: origin ? (place.originPoint?.lng ?? null) : null,
    commuteMinutes: origin && place.text.trim() ? place.commuteMinutes : null,
  };
}

export function formFromSession(session: Session, tz: string): SessionForm {
  const start = session.scheduledStartTime ? zonedDate(session.scheduledStartTime, tz) : null;
  const startMin = start ? start.getHours() * 60 + start.getMinutes() : 9 * 60;
  const endMin = startMin + session.durationMinutes;
  return {
    type: session.type as SessionType,
    title: session.title,
    date: start ? format(start, "yyyy-MM-dd") : "",
    startTime: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`,
    endTime: `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`,
    duration: session.durationMinutes,
    deadline: session.deadline ? format(zonedDate(session.deadline, tz), "yyyy-MM-dd") : "",
    place: placeFromSession(session),
    reminders: session.reminders ?? [],
    tags: session.tags.join(", "),
    note: session.note ?? "",
  };
}

/** A new plan: a task with a deadline, one reminder when the user has a default. */
export function draftForm(deadline: string, defaultReminder: number | null): SessionForm {
  return {
    type: "TASK",
    title: "",
    date: "",
    startTime: "09:00",
    endTime: "10:00",
    duration: DRAFT_DURATION,
    deadline,
    place: { text: "", point: null, origin: "", originPoint: null, commuteMinutes: null },
    reminders: defaultReminder != null ? [defaultReminder] : [],
    tags: "",
    note: "",
  };
}

/** Start of a `yyyy-MM-dd` day in `tz` as an instant. */
export function instantAtStart(day: string, hhmm: string, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  return zonedWallClockToUtc(new Date(y, m - 1, d, h, mi, 0, 0), tz).toISOString();
}

/** End of a `yyyy-MM-dd` day in `tz`, the deadline ceiling. */
export function instantAtEnd(day: string, tz: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return zonedWallClockToUtc(new Date(y, m - 1, d, 23, 59, 0, 0), tz).toISOString();
}

/** A fixed session's length from its clock times, on the 15-minute grid. */
export function fixedDuration(startTime: string, endTime: string): number {
  return Math.max(15, snap(hhmmToMinutes(endTime) - hhmmToMinutes(startTime)));
}

/** Only the fields that changed, as a PATCH body. */
export function patchFor(
  names: ReadonlySet<keyof SessionForm>,
  form: SessionForm,
  session: Session,
  tz: string,
): UpdateSessionInput {
  const patch: UpdateSessionInput = {};
  if (names.has("title") && form.title.trim() && form.title.trim() !== session.title) {
    patch.title = form.title.trim();
  }
  if (names.has("place")) {
    const next = placeToSession(form.place);
    const keys = Object.keys(next) as (keyof typeof next)[];
    for (const key of keys) {
      if ((session[key] ?? null) !== next[key]) patch[key] = next[key] as never;
    }
  }
  if (names.has("tags")) {
    const tags = form.tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (tags.join("|") !== session.tags.join("|")) patch.tags = tags;
  }
  if (names.has("reminders")) {
    const current = [...(session.reminders ?? [])].sort((a, b) => a - b).join("|");
    const next = [...form.reminders].sort((a, b) => a - b).join("|");
    if (current !== next) patch.reminders = form.reminders;
  }
  if (names.has("note")) {
    const note = form.note || null;
    if ((session.note ?? null) !== note) patch.note = note;
  }
  if (session.type === "TASK") {
    if (names.has("deadline") && form.deadline) patch.deadline = instantAtEnd(form.deadline, tz);
    if (names.has("duration")) patch.durationMinutes = form.duration;
  } else if ((names.has("date") || names.has("startTime") || names.has("endTime")) && form.date) {
    patch.scheduledStartTime = instantAtStart(form.date, form.startTime, tz);
    patch.durationMinutes = fixedDuration(form.startTime, form.endTime);
  }
  return patch;
}

/** The request that creates a draft. Throws nothing; the sheet validates first. */
export function createInput(form: SessionForm, tz: string): CreateSessionInput {
  const base = {
    title: form.title.trim(),
    note: form.note || null,
    ...placeToSession(form.place),
    tags: form.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
    reminders: form.reminders,
  };
  if (form.type === "TASK") {
    return {
      ...base,
      type: "TASK",
      durationMinutes: form.duration,
      deadline: instantAtEnd(form.deadline, tz),
    };
  }
  return {
    ...base,
    type: form.type,
    durationMinutes: fixedDuration(form.startTime, form.endTime),
    scheduledStartTime: instantAtStart(form.date, form.startTime, tz),
  };
}
