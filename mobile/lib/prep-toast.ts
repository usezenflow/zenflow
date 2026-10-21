import type { Session, UpdateSessionResponse } from "@zenflow/shared";
import { zonedDate } from "@zenflow/core";
import { getSessionDetails, slotPick, updateSession } from "@/api/tasks";
import { format, t } from "./i18n";
import { showMovedToast } from "./move-toast";
import { UNDO_WINDOW_MS } from "./undo";
import type { ToastAction, useToast } from "@/components/ui/toast";

type Toast = ReturnType<typeof useToast>["toast"];

/** "18:00, Fri": the short form the offer buttons use. */
export const timeLabel = (iso: string, tz: string) => format(zonedDate(iso, tz), "HH:mm, EEE");

/** One prep plan and the two times the scheduler offers for it. */
export interface TimePickOffer {
  /** The prep plan. */
  id: string;
  title: string;
  proposalId: string;
  /** The time the scheduler applied (ISO). Keep leaves it as it is. */
  primary: string;
  /** The other policy's time (ISO). Prefer moves the plan there. */
  alternative: string;
  /** Runs when the offer is swiped away, after the applied time has stood. */
  onDismiss?: () => void;
}

/**
 * The offer for a placed prep plan: two large choices that stay until one is
 * taken. Keep keeps the applied time and records it; Prefer moves the plan to
 * the other. Swiping it away keeps the applied time and records nothing.
 */
export function showTimePick(toast: Toast, offer: TimePickOffer, tz: string) {
  const { id, title, proposalId, primary, alternative } = offer;

  const fail = () =>
    toast({
      title: t("Couldn't reschedule prep plans"),
      variant: "destructive",
      icon: "calendar-x",
    });
  toast({
    title: t("Pick a time for your prep"),
    description: title,
    variant: "info",
    icon: "calendar-clock",
    confirm: {
      cancelLabel: t("Keep {when}", { when: timeLabel(primary, tz) }),
      confirmLabel: t("Prefer {when}", { when: timeLabel(alternative, tz) }),
      onCancel: () =>
        void slotPick(id, { slotProposalId: proposalId, chose: "primary" })
          .then(() =>
            toast({
              title: t("Kept {when}", { when: timeLabel(primary, tz) }),
              variant: "success",
              icon: "calendar-check",
            }),
          )
          .catch(fail),
      onDismiss: () => offer.onDismiss?.(),
      onConfirm: () =>
        void slotPick(id, { slotProposalId: proposalId, chose: "alternative" })
          .then(() =>
            showMovedToast(toast, {
              to: zonedDate(alternative, tz),
              withTime: true,
            }),
          )
          .catch(fail),
    },
  });
}

/** The two-time pick for a prep plan the scheduler just placed, if it has two good times. */
function offerTimePick(toast: Toast, prep: UpdateSessionResponse, tz: string) {
  if (!prep.divergent || !prep.slotProposalId || !prep.primarySlot || !prep.alternativeSlot) return;
  showTimePick(
    toast,
    {
      id: prep.id,
      title: prep.title,
      proposalId: prep.slotProposalId,
      primary: prep.primarySlot,
      alternative: prep.alternativeSlot,
    },
    tz,
  );
}

/**
 * After a lecture moves, offers to move the prep plans linked to it. Their
 * deadline is the lecture start, so each is re-placed against the new one.
 * When the scheduler has two good times for a plan, the user picks one.
 * `moved` is the lecture as the move returned it: a single moved occurrence
 * becomes a new row, and its plans follow it. Quiet when nothing is linked or
 * all are done.
 */
export async function offerPrepReschedule(
  toast: Toast,
  moved: Pick<Session, "id" | "type">,
  newStartISO: string,
  tz: string,
): Promise<void> {
  if (moved.type !== "LECTURE") return;
  const { prepSessions } = await getSessionDetails(moved.id).catch(() => ({
    prepSessions: [] as Session[],
  }));
  const open = prepSessions.filter(
    (p) => !p.skipped && p.deadline !== newStartISO,
  );
  if (open.length === 0) return;
  toast({
    title: t("Reschedule prep plans?"),
    description: t("Plan around the new lecture time."),
    variant: "info",
    icon: "calendar-clock",
    duration: UNDO_WINDOW_MS,
    action: {
      label: t("Reschedule"),
      onPress: () => {
        void Promise.all(open.map((p) => updateSession(p.id, { deadline: newStartISO })))
          .then((results) => {
            const picks = results.filter((r) => r.divergent);
            if (picks.length === 0) {
              toast({
                title: t("Prep plans rescheduled"),
                variant: "success",
                icon: "calendar-check",
              });
              return;
            }
            for (const prep of picks) offerTimePick(toast, prep, tz);
          })
          .catch(() =>
            toast({
              title: t("Couldn't reschedule prep plans"),
              variant: "destructive",
              icon: "calendar-x",
            }),
          );
      },
    },
  });
}
