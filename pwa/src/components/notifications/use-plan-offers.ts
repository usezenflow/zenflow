import { useEffect } from "react";
import { recordClientEvents } from "@/api/client-events";
import { listNotifications, markNotificationActionTaken } from "@/api/notifications";
import { isOpenPlanOffer, offerTimes } from "@/lib/plan-offer";
import { showTimePick } from "@/lib/prep-toast";

/** An offer older than this is no longer asked about when the app opens. */
const OPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Offers already shown this page session, so an open never repeats one. */
const shownOnOpen = new Set<string>();

/**
 * On page open and each return to the tab: reports the open and asks about the
 * newest unanswered prep offer once, in a toast.
 */
export function usePlanOffers(tz: string): void {
  useEffect(() => {
    let alive = true;
    const onOpen = () => {
      void recordClientEvents([{ kind: "APP_OPEN", channel: null, slotProposalId: null, sessionId: null }]);
      void listNotifications({ limit: 20 })
        .then(({ notifications }) => {
          if (!alive) return;
          const now = Date.now();
          const offer = notifications.find(
            (n) =>
              isOpenPlanOffer(n) && now - new Date(n.sentAt).getTime() < OPEN_WINDOW_MS && !shownOnOpen.has(n.id),
          );
          if (!offer || !offer.sessionId || !offer.slotProposalId) return;
          shownOnOpen.add(offer.id);
          void recordClientEvents([
            {
              kind: "OFFER_SHOWN",
              channel: "TOAST",
              slotProposalId: offer.slotProposalId,
              sessionId: offer.sessionId,
            },
          ]);
          showTimePick(
            {
              id: offer.sessionId,
              title: offer.content,
              proposalId: offer.slotProposalId,
              ...offerTimes(offer),
              onDismiss: () => void markNotificationActionTaken(offer.id).catch(() => undefined),
            },
            tz,
          );
        })
        .catch(() => undefined);
    };
    onOpen();
    const onVisible = () => {
      if (document.visibilityState === "visible") onOpen();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tz]);
}
