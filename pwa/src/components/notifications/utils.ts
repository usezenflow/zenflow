import { SESSION_TYPE_META } from "@zenflow/core";
import {
  notificationCategory,
  notificationEventKind,
  type NotificationCategory,
  type NotificationEventKind,
  type NotificationDto,
  type SessionType,
} from "@zenflow/shared";
import { format } from "date-fns";
import { Bell, CircleCheck, type LucideIcon, RefreshCw, Star, Trash2, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { dateFnsLocale, getLanguage, t } from "@/lib/i18n";
import { zonedDate } from "@/utils/tz";
import { sessionTypeIcon } from "@/components/calendar/session-type-badge";

/** Which session type a category put on the calendar. `REMINDER` puts nothing. */
const CATEGORY_TYPE: Record<NotificationCategory, SessionType | null> = {
  ASSIGNMENT: "ASSIGNMENT",
  EXAM: "EXAM",
  LECTURE: "LECTURE",
  REMINDER: null,
  MARKS: null,
};

/** Event kinds that stand apart from their category: done, changed, removed. */
const KIND_VISUAL: Partial<Record<NotificationEventKind, { Icon: LucideIcon; tint: string }>> = {
  COMPLETED: {
    Icon: CircleCheck,
    tint: "border-emerald-500/50 bg-emerald-500/20 text-emerald-700 dark:text-emerald-400",
  },
  UPDATED: {
    Icon: RefreshCw,
    tint: "border-sky-500/50 bg-sky-500/20 text-sky-700 dark:text-sky-400",
  },
  REMOVED: {
    Icon: Trash2,
    tint: "border-rose-500/50 bg-rose-500/20 text-rose-700 dark:text-rose-400",
  },
};

/**
 * Icon + tile tint for a notification, as on mobile: a conflict, marks, done,
 * changed or removed gets its own glyph; the rest take the calendar session
 * block's icon and type accent, and a reminder the bell.
 */
export function notificationVisual(eventName: string): {
  Icon: LucideIcon;
  tint: string;
} {
  if (isConflict(eventName))
    return {
      Icon: TriangleAlert,
      tint: "border-amber-500/50 bg-amber-500/20 text-amber-700 dark:text-amber-400",
    };
  const category = notificationCategory(eventName);
  const type = CATEGORY_TYPE[category];
  if (type) {
    const kindVisual = KIND_VISUAL[notificationEventKind(eventName)];
    if (kindVisual) return kindVisual;
    const meta = SESSION_TYPE_META[type];
    return {
      Icon: sessionTypeIcon(type),
      tint: cn("border", meta.badgeClass, meta.textClass),
    };
  }
  if (category === "MARKS")
    return {
      Icon: Star,
      tint: "border-violet-500/50 bg-violet-500/20 text-violet-700 dark:text-violet-400",
    };
  return { Icon: Bell, tint: "border-primary/50 bg-primary/20 text-primary" };
}

/**
 * The "due" or clock label for a row, off the linked session's end instant.
 * An assignment reads "due Jul 8"; anything with a clock time reads
 * "Jul 5, 9:00 AM" (English) or "5/7, 09:00" (Vietnamese). Null for grouped
 * rows and drops.
 */
export function eventTimeLabel(n: NotificationDto, tz: string): string | null {
  if (!n.eventEndsAt) return null;
  const at = zonedDate(n.eventEndsAt, tz);
  const vi = getLanguage() === "vi";
  const locale = dateFnsLocale();
  const date = format(at, vi ? "d/M" : "MMM d", { locale });
  if (notificationCategory(n.eventName) === "ASSIGNMENT")
    return t("due {date}", { date });
  return `${date}, ${format(at, vi ? "HH:mm" : "h:mm a", { locale })}`;
}

/** True for a sync-conflict notification. */
export function isConflict(eventName: string): boolean {
  return notificationEventKind(eventName) === "CONFLICT";
}

/** Event kinds that reflect a session change, so the calendar should refetch. */
export function changesCalendar(eventName: string): boolean {
  try {
    const kind = notificationEventKind(eventName);
    return kind !== "CONFLICT" && kind !== "REMINDER";
  } catch {
    return false;
  }
}
