import { updateSession } from "@/api/tasks";
import { t } from "@/lib/i18n";
import { offerApplyToAll } from "@/lib/recurring-scope";
import { isSessionPastDeadline } from "@/lib/overdue";
import { rememberPlacement } from "@/lib/slot-alternatives";
import {
  type ToastFn,
  showDisplacedToast,
  showErrorToast,
  withInfeasibleRetry,
} from "@/lib/task-toasts";
import { warmLandingDay } from "@/lib/warm-day";
import {
  type SessionFormType,
  type SessionFormValues,
  combineToUtc,
  getSeriesKind,
  hhmmToMinutes,
  zonedDate,
} from "@zenflow/core";
import type { Session, UpdateSessionInput } from "@zenflow/shared";

/** Form values for a saved session, as the inline editor's fields read them. */
export function valuesFromSession(session: Session, tz: string): SessionFormValues {
  const base: SessionFormValues = {
    type: session.type as SessionFormType,
    title: session.title,
    tags: session.tags ?? [],
    note: session.note ?? "",
    location: session.location ?? "",
    locationLat: session.locationLat,
    locationLng: session.locationLng,
    duration: session.durationMinutes,
    deadline: session.deadline ?? "",
  };
  if (!session.scheduledStartTime) return base;
  const start = zonedDate(session.scheduledStartTime, tz);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + session.durationMinutes;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    ...base,
    date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
    startTime: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`,
    endTime: `${pad(Math.floor(endMin / 60) % 24)}:${pad(endMin % 60)}`,
  };
}

/**
 * The part of the form that changed, as a PATCH body. `names` are the form
 * fields touched since the last save; a fixed session's time is sent whole,
 * since its start and length come from the same two fields.
 */
export function patchFor(
  names: ReadonlySet<string>,
  values: SessionFormValues,
  session: Session,
  tz: string,
): UpdateSessionInput {
  const patch: UpdateSessionInput = {};
  if (session.type === "TASK") {
    if (names.has("deadline")) patch.deadline = values.deadline;
    if (names.has("duration")) patch.durationMinutes = values.duration;
    if ((names.has("date") || names.has("startTime")) && values.date && values.startTime) {
      patch.scheduledStartTime = combineToUtc(values.date, values.startTime, tz);
    }
  } else if (names.has("date") || names.has("startTime") || names.has("endTime")) {
    patch.scheduledStartTime = combineToUtc(
      values.date as string,
      values.startTime as string,
      tz,
    );
    patch.durationMinutes =
      hhmmToMinutes(values.endTime as string) - hhmmToMinutes(values.startTime as string);
  }
  return patch;
}

/** Whether a patch moves a session off its saved time. */
export function movesSession(patch: UpdateSessionInput, session: Session): boolean {
  return (
    patch.scheduledStartTime !== undefined &&
    patch.scheduledStartTime !== session.scheduledStartTime
  );
}

/**
 * Saves a patch and hands the saved row to `onSaved`. A moved recurring
 * occurrence offers apply-to-all through an undo toast. A plan that cannot fit
 * offers the infeasible policies, and any other failure shows an error toast.
 */
export async function saveSession({
  toast,
  tz,
  session,
  patch,
  onSaved,
}: {
  toast: ToastFn;
  tz: string;
  session: Session;
  patch: UpdateSessionInput;
  onSaved: (updated: Session) => void | Promise<void>;
}): Promise<void> {
  if (
    movesSession(patch, session) &&
    getSeriesKind(session) === "recurring" &&
    patch.scheduledStartTime
  ) {
    // Only the time is scoped: the occurrence it detaches keeps the rest.
    const landed = patch.scheduledStartTime;
    const send = async (scope: "occurrence" | "series") => {
      try {
        await updateSession(session.id, {
          scheduledStartTime: landed,
          durationMinutes: patch.durationMinutes,
          scope,
        });
      } catch (error) {
        showErrorToast(toast, error, t("Couldn't update session"), "calendar-x");
      }
    };
    offerApplyToAll(toast, send);
    await warmLandingDay(landed, tz);
    await onSaved({ ...session, scheduledStartTime: landed, durationMinutes: patch.durationMinutes ?? session.durationMinutes });
    return;
  }

  await withInfeasibleRetry(
    toast,
    (infeasiblePolicy) =>
      updateSession(session.id, infeasiblePolicy ? { ...patch, infeasiblePolicy } : patch),
    async (updated) => {
      rememberPlacement(updated);
      if (updated.scheduledStartTime) await warmLandingDay(updated.scheduledStartTime, tz);
      showDisplacedToast(toast, updated.displacedSessions);
      if (isSessionPastDeadline(updated)) {
        toast({
          title: t("Scheduled after deadline"),
          description: t("This session now ends past its due time."),
          variant: "warning",
          icon: "calendar-clock",
          duration: 5000,
        });
      }
      await onSaved(updated);
    },
    (error) => showErrorToast(toast, error, t("Couldn't update session"), "calendar-x"),
  );
}

/** Starting values for a plan that is not placed yet: a title and a deadline. */
export function draftValues(draft: { title: string; deadline: string }): SessionFormValues {
  return {
    type: "TASK",
    title: draft.title,
    duration: 60,
    tags: [],
    note: "",
    location: "",
    deadline: draft.deadline,
  };
}
