import { listNotifications, markNotificationActionTaken } from "@/api/notifications";
import { useToast } from "@/components/ui/toast";
import { isOpenPlanOffer, offerTimes } from "@/lib/plan-offer";
import { showTimePick } from "@/lib/prep-toast";
import type { NotificationDto } from "@zenflow/shared";
import { useEffect } from "react";
import { AppState } from "react-native";

/** An offer older than this is no longer asked about on app open. */
const OPEN_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Offers already shown this app session, so an app open never repeats one. */
const shownOnOpen = new Set<string>();
/** Offers already reported as shown in the inbox this app session. */
const shownInInbox = new Set<string>();

/** Reports that an offer was shown in the inbox. Once per offer per session. */
export function reportInboxOffer(n: NotificationDto): void {
  if (!isOpenPlanOffer(n) || shownInInbox.has(n.id)) return;
  shownInInbox.add(n.id);
}

/**
 * On app open and each return to the foreground: reports the open (passive
 * exposure) and asks about the newest unanswered prep offer once, in a toast.
 */
export function usePlanOffers(tz: string): void {
  const { toast } = useToast();

  useEffect(() => {
    let alive = true;
    const onOpen = () => {
      void listNotifications({ limit: 20 })
        .then(({ notifications }) => {
          if (!alive) return;
          const now = Date.now();
          const offer = notifications.find(
            (n) =>
              isOpenPlanOffer(n) &&
              now - new Date(n.sentAt).getTime() < OPEN_WINDOW_MS &&
              !shownOnOpen.has(n.id),
          );
          if (!offer || !offer.sessionId || !offer.slotProposalId) return;
          shownOnOpen.add(offer.id);
          showTimePick(
            toast,
            {
              id: offer.sessionId,
              title: offer.content,
              proposalId: offer.slotProposalId,
              ...offerTimes(offer),
              onDismiss: () =>
                void markNotificationActionTaken(offer.id).catch(() => undefined),
            },
            tz,
          );
        })
        .catch(() => undefined);
    };
    onOpen();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") onOpen();
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, [tz, toast]);
}
