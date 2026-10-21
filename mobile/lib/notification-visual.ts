import {
  AlertTriangle,
  Bell,
  CheckCircle,
  type LucideIcon,
  RefreshCw,
  Star,
  Trash2,
} from "@/components/Icons";
import { sessionTypeIcon } from "@/components/calendar/session-type-badge";
import type { ToastAccent } from "@/components/ui/toast";
import {
  type NotificationCategory,
  type NotificationEventKind,
  type SessionType,
  notificationCategory,
  notificationEventKind,
} from "@zenflow/shared";
import {
  SESSION_TONE_CLASSES,
  SESSION_TONES,
  SESSION_TYPE_TONE,
} from "@zenflow/core";
import { t } from "./i18n";

/** The calendar type a category's row stands for, so it takes that type's colour and icon. */
const CATEGORY_SESSION_TYPE: Partial<Record<NotificationCategory, SessionType>> = {
  ASSIGNMENT: "ASSIGNMENT",
  EXAM: "EXAM",
  LECTURE: "LECTURE",
};

/** Event kinds that stand apart from their category: done, changed, removed. */
const KIND_VISUAL: Partial<
  Record<
    NotificationEventKind,
    { Icon: LucideIcon; tint: string; ink: { light: string; dark: string } }
  >
> = {
  COMPLETED: {
    Icon: CheckCircle,
    tint: "border-emerald-500/50 bg-emerald-500/20",
    ink: { light: "#047857", dark: "#34d399" },
  },
  UPDATED: {
    Icon: RefreshCw,
    tint: "border-sky-500/50 bg-sky-500/20",
    ink: { light: "#0369a1", dark: "#38bdf8" },
  },
  REMOVED: {
    Icon: Trash2,
    tint: "border-rose-500/50 bg-rose-500/20",
    ink: { light: "#be123c", dark: "#fb7185" },
  },
};

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  get ASSIGNMENT() {
    return t("LMS Assignment");
  },
  get EXAM() {
    return t("Exam");
  },
  get LECTURE() {
    return t("Timetable");
  },
  get REMINDER() {
    return t("Reminder");
  },
  get MARKS() {
    return t("Marks");
  },
};

/**
 * Icon and colors for a notification's eventName. Session categories take the
 * calendar block's own type colour and icon. Shared by the inbox rows and the live
 * notification toast, so both show the same glyph for the same kind.
 * `iconColor` is the inbox's single ink; `accent` adds a dark-scheme pair.
 */
export function notificationVisual(
  eventName: string,
  linkedType: SessionType | null = null,
): {
  Icon: LucideIcon;
  label: string;
  /** Translucent fill and rim: a glass badge in the category's colour. */
  tint: string;
  /** Icon colour per scheme, strong enough to read on the glass. */
  ink: { light: string; dark: string };
  accent: ToastAccent;
} {
  const category = notificationCategory(eventName);
  if (notificationEventKind(eventName) === "CONFLICT") {
    const ink = { light: "#b45309", dark: "#fbbf24" };
    return {
      Icon: AlertTriangle,
      label: t("{category} conflict", { category: CATEGORY_LABEL[category] }),
      tint: "border-amber-500/50 bg-amber-500/20",
      ink,
      accent: ink,
    };
  }
  const sessionType =
    category === "REMINDER" ? linkedType : CATEGORY_SESSION_TYPE[category];
  const kindVisual = sessionType ? KIND_VISUAL[notificationEventKind(eventName)] : undefined;
  if (kindVisual) {
    return {
      Icon: kindVisual.Icon,
      label: CATEGORY_LABEL[category],
      tint: kindVisual.tint,
      ink: kindVisual.ink,
      accent: kindVisual.ink,
    };
  }
  if (sessionType) {
    const tone = SESSION_TYPE_TONE[sessionType];
    const { ink } = SESSION_TONES[tone];
    return {
      Icon: sessionTypeIcon(sessionType),
      label: CATEGORY_LABEL[category],
      tint: SESSION_TONE_CLASSES[tone].badge,
      ink,
      accent: ink,
    };
  }
  switch (category) {
    case "MARKS": {
      const ink = { light: "#6d28d9", dark: "#a78bfa" };
      return {
        Icon: Star,
        label: CATEGORY_LABEL.MARKS,
        tint: "border-violet-500/50 bg-violet-500/20",
        ink,
        accent: ink,
      };
    }
    default: {
      const ink = { light: "#c2410c", dark: "#fb923c" };
      return {
        Icon: Bell,
        label: CATEGORY_LABEL.REMINDER,
        tint: "border-primary/50 bg-primary/20",
        ink,
        accent: ink,
      };
    }
  }
}

/** `icon` + `accent` for a notification's toast. Tolerates a missing or
 * unrecognized eventName (an older push payload) with the reminder bell. */
export function notificationToastVisual(
  eventName: string | undefined,
  linkedType: SessionType | null = null,
): {
  icon: LucideIcon;
  accent: ToastAccent;
} {
  try {
    if (eventName) {
      const { Icon, accent } = notificationVisual(eventName, linkedType);
      return { icon: Icon, accent };
    }
  } catch {
    // Unrecognized eventName — fall through to the bell.
  }
  return { icon: Bell, accent: SESSION_TONES.task.ink };
}
