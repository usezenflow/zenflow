import type { Session, UpdateSessionResponse } from "@zenflow/shared";
import { zonedDate } from "@zenflow/core";
import { getSessionDetails, removeSession, slotPick, updateSession } from "@/api/tasks";
import { format, t } from "./i18n";
import { showMovedToast } from "./move-toast";
import { UNDO_WINDOW_MS } from "./undo";
import type { ToastAction, useToast } from "@/components/ui/toast";

type Toast = ReturnType<typeof useToast>["toast"];

const whenLabel = (iso: string, tz: string) => format(zonedDate(iso, tz), "EEE, MMM d, HH:mm");

/** Stable 50/50 per proposal, so a re-render never swaps the two buttons. */
const primaryFirst = (proposalId: string): boolean =>
  [...proposalId].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 2 === 0;

/**
 * Two times for one prep plan, shown as equal buttons so the user picks. The
 * scheduler's pick is already applied; choosing it keeps it, the other one
 * moves the plan. Which button is which is not shown.
 */
function offerTimePick(toast: Toast, prep: UpdateSessionResponse, tz: string) {
  const proposalId = prep.slotProposalId;
  const primary = prep.primarySlot;
  const alternative = prep.alternativeSlot;
  if (!prep.divergent || !proposalId || !primary || !alternative) return;

  const fail = () =>
    toast({
      title: t("Couldn't reschedule prep plans"),
      variant: "destructive",
      icon: "calendar-x",
    });
  const keep: ToastAction = {
    label: whenLabel(primary, tz),
    onPress: () =>
      void slotPick(prep.id, { slotProposalId: proposalId, chose: "primary" })
        .then(() =>
          toast({
            title: t("Kept {when}", { when: whenLabel(primary, tz) }),
            variant: "success",
            icon: "calendar-check",
          }),
        )
        .catch(fail),
  };
  const swap: ToastAction = {
    label: whenLabel(alternative, tz),
    onPress: () =>
      void slotPick(prep.id, {
        slotProposalId: proposalId,
        chose: "alternative",
      })
        .then(() =>
          showMovedToast(toast, {
            to: zonedDate(alternative, tz),
            withTime: true,
          }),
        )
        .catch(fail),
  };
  toast({
    title: t("Pick a time for your prep"),
    description: prep.title,
    variant: "info",
    icon: "calendar-clock",
    duration: UNDO_WINDOW_MS,
    actions: primaryFirst(proposalId) ? [keep, swap] : [swap, keep],
  });
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
    (p) => !p.completedAt && !p.skipped && p.deadline !== newStartISO,
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

/**
 * After a lecture, exam or assignment is skipped, asks what to do with its open
 * prep plans: delete them, or (when a later unskipped class has none) prepare
 * for that class instead. Ignoring the toast keeps them. Quiet when there is
 * nothing open to ask about.
 */
export async function offerPrepAfterSkip(
  toast: Toast,
  skipped: Pick<Session, "id">,
  tz: string,
): Promise<void> {
  const detail = await getSessionDetails(skipped.id).catch(() => null);
  const open = (detail?.prepSessions ?? []).filter((p) => !p.completedAt && !p.skipped);
  if (!detail || open.length === 0) return;

  const fail = () =>
    toast({
      title: t("Couldn't update prep plans"),
      variant: "destructive",
      icon: "calendar-x",
    });
  const actions: ToastAction[] = [
    {
      label: t("Delete plan"),
      onPress: () =>
        void Promise.all(open.map((p) => removeSession(p.id)))
          .then(() =>
            toast({ title: t("Prep plans deleted"), variant: "success", icon: "calendar-check" }),
          )
          .catch(fail),
    },
  ];
  const next = detail.nextPrepOccurrenceStart;
  if (next) {
    actions.push({
      label: t("Next class"),
      onPress: () =>
        void Promise.all(
          open.map((p) => updateSession(p.id, { deadline: next, prepForOccurrenceStart: next })),
        )
          .then((results) => {
            const picks = results.filter((r) => r.divergent);
            if (picks.length === 0) {
              toast({
                title: t("Prep moved to {when}", { when: whenLabel(next, tz) }),
                variant: "success",
                icon: "calendar-check",
              });
              return;
            }
            for (const prep of picks) offerTimePick(toast, prep, tz);
          })
          .catch(fail),
    });
  }
  toast({
    title: t("Keep your prep plan?"),
    description: t("It stays unless you pick one."),
    variant: "info",
    icon: "calendar-clock",
    duration: UNDO_WINDOW_MS,
    actions,
  });
}
