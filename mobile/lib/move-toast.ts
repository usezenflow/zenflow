import { durationLabel } from "./duration-label";
import { format, t } from "./i18n";
import { UNDO_WINDOW_MS } from "./undo";
import type { useToast } from "@/components/ui/toast";

type Toast = ReturnType<typeof useToast>["toast"];

/**
 * Confirms a drag-and-drop or "Move to…" reschedule with a quiet "Moved to …".
 * `onUndo` adds an Undo button for the undo window.
 */
export function showMovedToast(
  toast: Toast,
  opts: { to: Date; withTime: boolean; onUndo?: () => void },
): void {
  const action = opts.onUndo
    ? { label: t("Undo"), onPress: opts.onUndo }
    : undefined;
  // Date and time both matter, so they share the title: "Moved to Tue, Oct 14, 09:00".
  const date = format(opts.to, "EEE, MMM d");
  toast({
    title: t("Moved to {when}", {
      when: opts.withTime ? `${date}, ${format(opts.to, "HH:mm")}` : date,
    }),
    variant: "success",
    icon: "calendar-check",
    duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
    action,
  });
}

/** Confirms an auto resolve that moved `count` sessions. `late` names sessions now past their deadline. */
export function showMovedCountToast(
  toast: Toast,
  opts: { count: number; late: number; onUndo?: () => void },
): void {
  const action = opts.onUndo
    ? { label: t("Undo"), onPress: opts.onUndo }
    : undefined;
  toast({
    title:
      opts.count === 1
        ? t("Moved 1 session")
        : t("Moved {count} sessions", { count: opts.count }),
    description: opts.late
      ? t("{count} now past deadline", { count: opts.late })
      : undefined,
    icon: "calendar-check",
    duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
    action,
  });
}

/** Confirms a change of length with the start unchanged: "Duration set to 2 hours". */
export function showResizedToast(
  toast: Toast,
  opts: { minutes: number; onUndo?: () => void },
): void {
  toast({
    title: t("Duration set to {duration}", {
      duration: durationLabel(opts.minutes),
    }),
    variant: "success",
    icon: "calendar-check",
    duration: opts.onUndo ? UNDO_WINDOW_MS : undefined,
    action: opts.onUndo ? { label: t("Undo"), onPress: opts.onUndo } : undefined,
  });
}
