import type {
  NotificationDto,
  NotificationsListResponse,
  RescheduleConflictsResponse,
} from "@zenflow/shared";
import { api } from "./base";

/** One page of the ingestion inbox — unread first, then newest first.
 * `unreadCount` counts the whole inbox (it drives the bell badge). */
export async function listNotifications(
  params: { limit?: number; offset?: number } = {},
): Promise<NotificationsListResponse> {
  const { data } = await api.get("/notifications", { params });
  return data.data;
}

/** Stamp `readAt`. Idempotent; keeps the first instant. */
export async function markNotificationRead(
  id: string,
): Promise<NotificationDto> {
  const { data } = await api.patch(`/notifications/${id}/read`);
  return data.data;
}

/** Stamp `actionTakenAt` — acting on a notification is not the same as seeing it. */
export async function markNotificationActionTaken(
  id: string,
): Promise<NotificationDto> {
  const { data } = await api.patch(`/notifications/${id}/action-taken`);
  return data.data;
}

/** Dismiss (hard-delete) one notification. 404 if it is not the caller's. */
export async function dismissNotification(id: string): Promise<{ id: string }> {
  const { data } = await api.delete(`/notifications/${id}`);
  return data.data;
}

/**
 * Re-run the scheduler over every flexible task the conflict notification
 * lists (`conflictSessionIds`). Partial success is normal — the ids that
 * couldn't be placed come back in `failedSessionIds`.
 */
export async function rescheduleConflicts(
  id: string,
): Promise<RescheduleConflictsResponse> {
  const { data } = await api.post(`/notifications/${id}/reschedule-conflicts`);
  return data.data;
}

export interface NotificationStreamOptions {
  onNotification: (notification: NotificationDto) => void;
  /** Fires on every (re)connect, so the caller can catch up on missed rows. */
  onOpen?: () => void;
  onError?: (event: Event) => void;
}

/**
 * Live inbox over SSE (`GET /notifications/stream`, the same stream mobile
 * reads). The browser retries a dropped connection itself. Returns close().
 */
export function subscribeNotificationsStream(
  options: NotificationStreamOptions,
): () => void {
  const source = new EventSource(`${api.defaults.baseURL}/notifications/stream`, {
    withCredentials: true,
  });
  source.onopen = () => options.onOpen?.();
  source.onmessage = (event: MessageEvent<string>) => {
    try {
      const data = JSON.parse(event.data) as NotificationDto;
      if (data && typeof data === "object" && "id" in data) {
        options.onNotification(data);
      }
    } catch {
      // A malformed frame is dropped; the next refresh catches the row up.
    }
  };
  source.onerror = (event) => options.onError?.(event);
  return () => source.close();
}
