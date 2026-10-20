import {
  PUSH_ACTION_KEEP,
  PUSH_ACTION_PREFER,
  type NotificationDto,
} from "@zenflow/shared";
import { slotPick } from "@/api/tasks";
import { t } from "./i18n";
import type { ToastFn } from "./task-toasts";

export type OfferChoice = "primary" | "alternative";

/** Keep is the scheduler's time; Prefer is the other policy's. `index` 0 is Keep. */
export function choiceForButton(index: 0 | 1): OfferChoice {
  return index === 0 ? "primary" : "alternative";
}

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

/** Keeps the chosen time for a prep plan. Never throws. */
export async function pickPlanOffer(
  toast: ToastFn,
  sessionId: string,
  slotProposalId: string,
  chose: OfferChoice,
): Promise<boolean> {
  try {
    await slotPick(sessionId, { slotProposalId, chose });
    toast({ title: t("Prep time updated"), variant: "success", icon: "calendar-check" });
    return true;
  } catch {
    toast({
      title: t("Couldn't update prep time"),
      variant: "destructive",
      icon: "calendar-x",
    });
    return false;
  }
}
