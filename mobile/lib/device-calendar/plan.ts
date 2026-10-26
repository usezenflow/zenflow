import type { Session } from "@zenflow/shared";
import { addDays } from "date-fns";

/** Which Zenflow calendar holds an event: the phone gives a colour to a calendar, not to an event. */
export type CalendarKind = "TASK" | "EXAM" | "ASSIGNMENT" | "LECTURE";
export const CALENDAR_KINDS: readonly CalendarKind[] = ["TASK", "EXAM", "ASSIGNMENT", "LECTURE"];

/** One event as the phone's calendar should hold it. `key` is the Zenflow session id. */
export interface DeviceEventSpec {
  key: string;
  kind: CalendarKind;
  title: string;
  startDate: Date;
  endDate: Date;
  timeZone: string;
  location: string | null;
  notes: string;
  /** Minutes before the start; 0 = no alarm. */
  alarmMinutes: number;
  /** Changes whenever anything the phone shows changes. */
  hash: string;
}

/** The phone event written for a session, and the times Zenflow last wrote to it. */
export interface DeviceLink {
  eventId: string;
  /** Absent on links written when there was one calendar: those events are in the task calendar. */
  kind?: CalendarKind;
  hash: string;
  startMs: number;
  /** Absent on links written before end times were kept; those skip move detection for length. */
  endMs?: number;
  /** The alarm last written, in minutes before start. Absent on links written before reminders were read back. */
  alarmMinutes?: number;
}

export type DeviceLinks = Record<string, DeviceLink>;

export interface PlanContext {
  timeZone: string;
  /** The alarm for sessions without their own `reminderMinutes`. */
  defaultReminderMinutes: number;
  /** Sessions starting outside [from, to] are neither written nor removed. */
  from: Date;
  to: Date;
  /** Formats the due line from the formatted date; defaults to English. */
  dueText?: (when: string) => string;
  /** Locale for the due date; defaults to English (UK). */
  locale?: string;
}

export interface SyncPlan {
  create: DeviceEventSpec[];
  update: { spec: DeviceEventSpec; eventId: string }[];
  remove: { key: string; eventId: string }[];
}

/** Small stable string hash; collisions only cost one skipped update. */
function hashOf(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function dueNote(deadline: string | null | undefined, ctx: PlanContext): string {
  if (!deadline) return "";
  const timeZone = ctx.timeZone;
  const when = new Intl.DateTimeFormat(ctx.locale ?? "en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(deadline));
  return ctx.dueText ? ctx.dueText(when) : `Due ${when}`;
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };
/** The phone's notes field is plain text and short: Moodle descriptions arrive as HTML. */
const NOTE_MAX = 1000;

/** A session note (HTML from the LMS) as plain text for the phone. */
export function noteText(html: string | null | undefined): string {
  if (!html) return "";
  const text = html
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|nbsp|#39);/g, (m) => ENTITIES[m])
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return text.length > NOTE_MAX ? `${text.slice(0, NOTE_MAX - 1)}…` : text;
}

/** Placed sessions in the window, as phone events. */
export function buildSpecs(sessions: Session[], ctx: PlanContext): DeviceEventSpec[] {
  const specs: DeviceEventSpec[] = [];
  for (const s of sessions) {
    if (!s.scheduledStartTime) continue;
    const start = new Date(s.scheduledStartTime);
    if (start < ctx.from || start > ctx.to) continue;
    // Busy time imported from the phone stays where it came from.
    if (s.source === "DEVICE") continue;
    const base = {
      key: s.id,
      kind: s.type === "EXAM" || s.type === "ASSIGNMENT" || s.type === "LECTURE" ? s.type : ("TASK" as const),
      title: s.title,
      startDate: start,
      endDate: new Date(start.getTime() + s.durationMinutes * 60_000),
      timeZone: ctx.timeZone,
      location: s.location ?? null,
      notes: [dueNote(s.deadline, ctx), noteText(s.note)].filter(Boolean).join("\n\n"),
      alarmMinutes: s.type === "DND" ? 0 : (s.reminderMinutes ?? ctx.defaultReminderMinutes),
    };
    specs.push({
      ...base,
      hash: hashOf([base.title, base.startDate.getTime(), base.endDate.getTime(), base.timeZone, base.location, base.notes, base.alarmMinutes]),
    });
  }
  return specs;
}

/** What to create, rewrite and delete to make the phone match `specs`. Past events are left as history. */
export function planSync(specs: DeviceEventSpec[], links: DeviceLinks, ctx: PlanContext): SyncPlan {
  const plan: SyncPlan = { create: [], update: [], remove: [] };
  const wanted = new Set<string>();
  for (const spec of specs) {
    wanted.add(spec.key);
    const link = links[spec.key];
    if (!link) plan.create.push(spec);
    else if (link.hash !== spec.hash) plan.update.push({ spec, eventId: link.eventId });
  }
  for (const [key, link] of Object.entries(links)) {
    if (wanted.has(key)) continue;
    const inWindow = link.startMs >= ctx.from.getTime() && link.startMs <= ctx.to.getTime();
    if (inWindow) plan.remove.push({ key, eventId: link.eventId });
  }
  return plan;
}

/** [from, to] day ranges that cover the window in requests of at most `maxDays` days each, ends included. */
export function listRanges(from: Date, to: Date, maxDays: number): [Date, Date][] {
  const ranges: [Date, Date][] = [];
  for (let start = from; start <= to; start = addDays(start, maxDays)) {
    const end = addDays(start, maxDays - 1);
    ranges.push([start, end < to ? end : to]);
  }
  return ranges;
}
