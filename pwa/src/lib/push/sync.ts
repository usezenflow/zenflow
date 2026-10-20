import { useUserStore } from "@/hooks/use-user-store";
import { syncPushForUser } from "@/lib/push/client";

/**
 * Re-registers the browser whenever a user is loaded (app start and login),
 * so a device removed on sign out gets back on the next session.
 */
export function startPushSync(): void {
  useUserStore.subscribe((state, prev) => {
    const user = state.user;
    if (user && user.id !== prev.user?.id) {
      void syncPushForUser(user.allowNotifications);
    }
  });
}
