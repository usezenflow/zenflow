import { useCallback, useEffect, useState } from "react";
import { useUserStore } from "@/hooks/use-user-store";
import { t } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import {
  turnOffNotifications,
  turnOnNotifications,
} from "@/lib/push/client";
import {
  isPushSupported,
  needsHomeScreenInstall,
  readPushPermission,
} from "@/lib/push/support";

/**
 * Web push state for the notifications switch. The switch is on only when the
 * browser supports push, permission is granted and `allowNotifications` is true.
 */
export function useWebPush() {
  const allowNotifications = useUserStore((s) => s.user?.allowNotifications ?? false);
  const [permission, setPermission] = useState(readPushPermission);
  const [busy, setBusy] = useState(false);
  const supported = isPushSupported();

  const refresh = useCallback(() => setPermission(readPushPermission()), []);

  // Permission can change in browser settings while the sheet is open.
  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  const canSwitch = supported && permission === "granted";

  async function enable() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await turnOnNotifications();
      refresh();
      if (result === "denied") {
        errorToast(t("Notifications are blocked"), {
          description: t("Allow them in browser settings."),
        });
      } else if (result === "failed") {
        errorToast(t("Couldn't turn on notifications"), {
          description: t("Try again in a moment."),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (busy) return;
    setBusy(true);
    try {
      await turnOffNotifications();
    } catch {
      errorToast(t("Couldn't save preference"), {
        description: t("Try again in a moment."),
      });
    } finally {
      setBusy(false);
    }
  }

  return {
    supported,
    needsInstall: needsHomeScreenInstall(),
    /** Permission not asked yet: show the Allow button. */
    undecided: supported && permission === "default",
    denied: supported && permission === "denied",
    canSwitch,
    busy,
    active: canSwitch && allowNotifications,
    enable,
    disable,
  };
}
