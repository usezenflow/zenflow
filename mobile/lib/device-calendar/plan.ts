import type { Session } from "@zenflow/shared";

/** One event as the phone's calendar should hold it. `key` is the Zenflow session id. */
export interface DeviceEventSpec {
  key: string;
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
  hash: string;
  startMs: number;
  /** Absent on links written before end times were kept; those skip move detection for length. */
  endMs?: number;
  /** The alarm last written, in minutes before start. Absent on links written before reminders were read back. */
  alarmMinutes?: number;
}

export type DeviceLinks = Record<string, DeviceLink>;

/** The phone has one calendar colour, so these types carry their label in the title. */
const TITLE_PREFIX: Partial<Record<Session["type"], string>> = {
  EXAM: "Exam: ",
  ASSIGNMENT: "Assignment: ",
};

export interface PlanContext {
  timeZone: string;
  /** The alarm for sessions without their own `reminderMinutes`. */
  defaultReminderMinutes: number;
  /** Sessions starting outside [from, to] are neither written nor removed. */
  from: Date;
  to: Date;
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

function dueNote(deadline: string | null | undefined, timeZone: string): string {
  if (!deadline) return "";
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(deadline));
  return `Due ${when}`;
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
      title: (TITLE_PREFIX[s.type] ?? "") + s.title,
      startDate: start,
      endDate: new Date(start.getTime() + s.durationMinutes * 60_000),
      timeZone: ctx.timeZone,
      location: s.location ?? null,
      notes: dueNote(s.deadline, ctx.timeZone),
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
