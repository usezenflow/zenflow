import { toast } from "@/lib/notify";
import { format } from "@/lib/format";
import { t } from "@/lib/i18n";
import { durationLabel } from "@/lib/duration-label";
import { UNDO_WINDOW_MS } from "@/lib/undo";

function undoAction(onUndo?: () => void) {
  return onUndo ? { label: t("Undo"), onClick: onUndo } : undefined;
}

/** Confirms a drag or "Move to" reschedule with "Moved to …". `onUndo` adds an Undo button for the undo window. */
export function showMovedToast(opts: { to: Date; withTime: boolean; onUndo?: () => void }): void {
  // Date and time both matter, so they share the title: "Moved to Tue, Oct 14, 09:00".
  const date = format(opts.to, "EEE, MMM d");
  toast.success(
    t("Moved to {when}", { when: opts.withTime ? `${date}, ${format(opts.to, "HH:mm")}` : date }),
    {
      icon: "calendar-clock",
      action: undoAction(opts.onUndo),
      duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
    },
  );
}

/** Confirms an auto resolve that moved `count` sessions. `late` names sessions now past their deadline. */
export function showMovedCountToast(opts: { count: number; late: number; onUndo?: () => void }): void {
  toast.success(
    opts.count === 1 ? t("Moved 1 session") : t("Moved {count} sessions", { count: opts.count }),
    {
      icon: "calendar-clock",
      description: opts.late ? t("{count} now past deadline", { count: opts.late }) : undefined,
      action: undoAction(opts.onUndo),
      duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
    },
  );
}

/** Confirms a change of length with the start unchanged. */
export function showResizedToast(opts: { minutes: number; onUndo?: () => void }): void {
  toast.success(t("Duration set to {duration}", { duration: durationLabel(opts.minutes) }), {
    icon: "calendar-clock",
    action: undoAction(opts.onUndo),
    duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
  });
}
