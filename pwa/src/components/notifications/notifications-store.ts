import {
  dismissNotification,
  listNotifications,
  markNotificationActionTaken,
  markNotificationRead,
  rescheduleConflicts,
} from "@/api/notifications";
import { getSessionDetails } from "@/api/tasks";
import { t } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import type { NotificationDto } from "@zenflow/shared";
import { toast } from "@/lib/notify";
import { create } from "zustand";

interface InboxState {
  items: NotificationDto[];
  /** Unread across the whole inbox, not just the loaded page. */
  unreadCount: number;
  loaded: boolean;
  refreshing: boolean;
  refresh: () => Promise<void>;
  /** Adds a row from the live stream. A repeat or a dismissed row is ignored. */
  receive: (n: NotificationDto) => void;
  markRead: (id: string) => void;
  markActionTaken: (id: string) => void;
  /** Removes rows at once; rolls back and throws if the server refuses. */
  remove: (ids: string[]) => Promise<void>;
  reset: () => void;
}

/**
 * Ids deleted this session. A list request already in flight when a row was
 * deleted would otherwise bring it back before its DELETE lands.
 */
const dismissed = new Set<string>();
let refreshVersion = 0;

const INITIAL = {
  items: [] as NotificationDto[],
  unreadCount: 0,
  loaded: false,
  refreshing: false,
};

export const useNotificationsStore = create<InboxState>((set, get) => ({
  ...INITIAL,

  refresh: async () => {
    const version = ++refreshVersion;
    set({ refreshing: true });
    try {
      const res = await listNotifications({ limit: 50 });
      if (version !== refreshVersion) return;
      set({
        items: res.notifications.filter((n) => !dismissed.has(n.id)),
        unreadCount: res.unreadCount,
        loaded: true,
      });
    } catch {
      // Best-effort: a failed refresh keeps the last list.
    } finally {
      if (version === refreshVersion) set({ refreshing: false });
    }
  },

  receive: (n) => {
    if (dismissed.has(n.id) || get().items.some((x) => x.id === n.id)) return;
    set((s) => ({
      items: [n, ...s.items],
      unreadCount: s.unreadCount + (n.readAt ? 0 : 1),
    }));
  },

  markRead: (id) => {
    const target = get().items.find((x) => x.id === id);
    if (!target || target.readAt) return;
    set((s) => ({
      items: s.items.map((x) =>
        x.id === id ? { ...x, readAt: new Date().toISOString() } : x,
      ),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }));
    markNotificationRead(id).catch(() => {});
  },

  markActionTaken: (id) => {
    set((s) => ({
      items: s.items.map((x) =>
        x.id === id && !x.actionTakenAt
          ? { ...x, actionTakenAt: new Date().toISOString() }
          : x,
      ),
    }));
    markNotificationActionTaken(id).catch(() => {});
  },

  remove: async (ids) => {
    if (ids.length === 0) return;
    const { items: prevItems, unreadCount: prevUnread } = get();
    const idSet = new Set(ids);
    const unreadRemoved = prevItems.filter(
      (x) => idSet.has(x.id) && !x.readAt,
    ).length;
    ids.forEach((id) => dismissed.add(id));
    set({
      items: prevItems.filter((x) => !idSet.has(x.id)),
      unreadCount: Math.max(0, prevUnread - unreadRemoved),
    });
    try {
      await Promise.all(ids.map((id) => dismissNotification(id)));
    } catch (error) {
      ids.forEach((id) => dismissed.delete(id));
      set({ items: prevItems, unreadCount: prevUnread });
      throw error;
    }
  },

  reset: () => set(INITIAL),
}));

/**
 * Opens the session a notification points at on the calendar. Returns false,
 * after a toast, when the session was deleted since the notification was raised.
 */
export async function openNotificationSession(
  n: NotificationDto,
): Promise<boolean> {
  if (!n.sessionId) return false;
  try {
    await getSessionDetails(n.sessionId);
  } catch {
    errorToast(t("Couldn't find that item"), {
      description: t("It's no longer on your calendar."),
    });
    return false;
  }
  window.dispatchEvent(
    new CustomEvent("zenflow:open-task", { detail: n.sessionId }),
  );
  if (!n.actionTakenAt) useNotificationsStore.getState().markActionTaken(n.id);
  return true;
}

/**
 * Re-places the tasks a conflict notification lists. A clean run retires the
 * notification; a partial one stamps it acted-on so the button hides.
 */
export async function rescheduleNotification(n: NotificationDto): Promise<void> {
  const store = useNotificationsStore.getState();
  try {
    const res = await rescheduleConflicts(n.id);
    const ok = res.rescheduled.length;
    const failed = res.failedSessionIds.length;
    if (failed === 0) {
      toast.success(t("Rescheduled {count} plans", { count: ok }), { icon: "calendar-check" });
    } else {
      toast.warning(t("Rescheduled {ok}, {failed} left", { ok, failed }), {
        icon: "calendar-x",
        description: t("The rest still overlap. Move them by hand."),
      });
    }
    window.dispatchEvent(new CustomEvent("zenflow:calendar-refresh"));
    if (failed === 0) {
      await store.remove([n.id]).catch(() => {});
    } else {
      store.markActionTaken(n.id);
    }
  } catch {
    errorToast(t("Couldn't reschedule plans"), {
      description: t("Try again in a moment."),
    });
  }
}
