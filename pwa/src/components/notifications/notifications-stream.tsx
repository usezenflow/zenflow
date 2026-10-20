import { subscribeNotificationsStream } from "@/api/notifications";
import { useUserStore } from "@/hooks/use-user-store";
import { playChime } from "@/lib/sounds";
import { pushToneFor } from "@zenflow/shared";
import { useEffect } from "react";
import { toast } from "@/lib/notify";

import {
  openNotificationSession,
  useNotificationsStore,
} from "./notifications-store";
import { changesCalendar, notificationVisual } from "./utils";

/**
 * Keeps the inbox live over SSE. Each new row lands in the store, refetches
 * the calendar when it changed a session, and raises a tap-to-open toast once
 * onboarding is done. Reconnects catch the inbox up.
 */
export function useNotificationsStream(): void {
  const userId = useUserStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!userId) return;
    const seen = new Set<string>();
    return subscribeNotificationsStream({
      onOpen: () => void useNotificationsStore.getState().refresh(),
      onNotification: (n) => {
        // Delivery is at-least-once: drop a row this stream already showed.
        if (seen.has(n.id)) return;
        seen.add(n.id);
        useNotificationsStore.getState().receive(n);
        if (changesCalendar(n.eventName)) {
          window.dispatchEvent(new CustomEvent("zenflow:calendar-refresh"));
        }
        // Onboarding stays quiet: the inbox only.
        const user = useUserStore.getState().user;
        if (!user?.onboardedAt) return;
        playChime(pushToneFor(n.eventName));
        const { Icon, tint } = notificationVisual(n.eventName);
        const id = toast(n.title, {
          description: n.content,
          icon: Icon,
          badgeClassName: tint,
          duration: 5000,
          onPress: n.sessionId
            ? () => {
                toast.dismiss(id);
                void openNotificationSession(n);
              }
            : undefined,
        });
      },
    });
  }, [userId]);
}
