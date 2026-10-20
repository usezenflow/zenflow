import { PUSH_ACTION_KEEP, PUSH_ACTION_PREFER, type NotificationDto } from "@zenflow/shared";
import { zonedDate } from "@zenflow/core";
import { slotPick } from "@/api/tasks";
import { format } from "@/lib/format";
import { t } from "@/lib/i18n";
import { showMovedToast } from "@/lib/move-toast";
import { errorToast } from "@/lib/toast";

export type OfferChoice = "primary" | "alternative";

/** The choice a plan-offer push button stands for, or `null` for any other action. */
export function choiceForAction(action: string): OfferChoice | null {
  if (action === PUSH_ACTION_KEEP) return "primary";
  if (action === PUSH_ACTION_PREFER) return "alternative";
  return null;
}

/** A plan offer's two times, `[keep, prefer]`. */
export function offerTimes(n: NotificationDto): { primary: string; alternative: string } {
  const [primary, alternative] = n.offerSlots;
  return { primary, alternative };
}

/** An unanswered `plan_offer.*` row with both times: its buttons can be shown. */
export function isOpenPlanOffer(n: NotificationDto): boolean {
  return (
    n.eventName.startsWith("plan_offer.") &&
    !n.actionTakenAt &&
    !!n.sessionId &&
    !!n.slotProposalId &&
    n.offerSlots.length === 2
  );
}

/** "18:00, Fri": the short form the offer buttons use. */
export const timeLabel = (iso: string, tz: string) => format(zonedDate(iso, tz), "HH:mm, EEE");

export interface TimePickOffer {
  /** The prep plan. */
  id: string;
  title: string;
  proposalId: string;
  /** The time the scheduler applied (ISO). Keep leaves it as it is. */
  primary: string;
  /** The other policy's time (ISO). Prefer moves the plan there. */
  alternative: string;
  /** Runs when the offer is dismissed, after the applied time has stood. */
  onDismiss?: () => void;
}

/** Keeps the chosen time for a prep plan. Never throws. */
export async function pickPlanOffer(
  id: string,
  proposalId: string,
  chose: OfferChoice,
  tz: string,
  alternative: string,
): Promise<boolean> {
  try {
    await slotPick(id, { slotProposalId: proposalId, chose });
    if (chose === "alternative") showMovedToast({ to: zonedDate(alternative, tz), withTime: true });
    return true;
  } catch {
    errorToast(t("Couldn't reschedule prep plans"));
    return false;
  }
}
