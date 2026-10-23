import type { PushDataPayload, PushTone } from "@zenflow/shared";

/**
 * A platform-agnostic push, ready for a sender to translate into an FCM
 * message or an APNs notification.
 */
export interface PushMessage {
  title: string;
  body: string;
  data: PushDataPayload;
  tone: PushTone;
  /** Action category (action buttons); `null` for a plain push. */
  category?: string | null;
  /** Button ids of `category`, in order (`pushActionsFor`). */
  actions?: readonly string[];
  /** Extra string-map keys merged into the data payload (e.g. a check-in's session ids). */
  extra?: Record<string, string>;
}

/** `category` and `actions` as string-map keys (FCM data, APNs custom payload); `{}` without buttons. */
export function actionFields(msg: PushMessage): Record<string, string> {
  if (!msg.category || !msg.actions?.length) return {};
  return { category: msg.category, actions: msg.actions.join(",") };
}

/** A Web Push subscription. `endpoint` is the device's `pushToken`. */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What a sender hands back so {@link PushService} can log + prune. */
export interface SendResult {
  /** How many of the given tokens the provider accepted. */
  sent: number;
  /**
   * Tokens the provider rejected as permanently dead (unregistered / gone) —
   * safe to delete. Transient failures are logged by the sender and omitted.
   */
  invalidTokens: string[];
}

/** {@link PushDataPayload} flattened to the string map FCM / APNs require. */
export function toStringMap(data: PushDataPayload): Record<string, string> {
  return {
    notificationId: data.notificationId,
    eventName: data.eventName,
    sessionId: data.sessionId,
    url: data.url,
  };
}
