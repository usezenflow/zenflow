/**
 * Push: device registration and the payload the client receives.
 *
 * A device is identified by one opaque `pushToken`: an FCM registration token
 * (Android), an APNs device token (iOS) or a Web Push subscription endpoint
 * (WEB). WEB also carries the subscription's `p256dh` and `auth` keys; native
 * platforms send `null` for both.
 *
 * As everywhere in this package: "absent" is an explicit value, never an
 * optional property, and everything that crosses the wire is a plain string.
 */


/**
 * Which Zenflow chime a push plays. Chosen server-side from the event so the
 * sound is right even when the app is closed (Android binds sound to the
 * notification channel, iOS to the payload's sound file).
 */
export type PushTone = "default" | "reminder" | "urgent";

/** Event slug → tone: reminders are soft, sync conflicts need action, the rest is the default chime. */
export function pushToneFor(eventName: string): PushTone {
  if (eventName === "reminder.fired") return "reminder";
  if (eventName.startsWith("sync_conflict.")) return "urgent";
  return "default";
}

/** iOS notification category that carries the conflict "Reschedule" button. */
export const PUSH_CATEGORY_CONFLICT = "sync_conflict";

/** Action identifier of that button (`NotificationResponse.actionIdentifier`). */
export const PUSH_ACTION_RESCHEDULE = "reschedule";

/** iOS notification category of a two-time plan offer (background buttons). */
export const PUSH_CATEGORY_PLAN_OFFER = "plan_offer";

/** Action identifiers of the two plan-offer buttons: keep the scheduler's time, or prefer the other. */
export const PUSH_ACTION_KEEP = "keep";
export const PUSH_ACTION_PREFER = "prefer";

/** iOS notification category of the session-end push (ADR-0035). */
export const PUSH_CATEGORY_SESSION_END = "session_end";

/** Action identifiers of the session-end buttons: a completed session, or not this time. */
export const PUSH_ACTION_DONE = "done";
export const PUSH_ACTION_NOT_THIS_TIME = "not_this_time";

/** Event slug → action category, or `null` when the push has no buttons. */
export function pushCategoryFor(eventName: string): string | null {
  if (eventName.startsWith("sync_conflict.")) return PUSH_CATEGORY_CONFLICT;
  if (eventName.startsWith("plan_offer.")) return PUSH_CATEGORY_PLAN_OFFER;
  if (eventName.startsWith("session_end.")) return PUSH_CATEGORY_SESSION_END;
  return null;
}

/** Action identifiers of a category's buttons, in button order; empty when it has none. */
export function pushActionsFor(category: string | null): readonly string[] {
  if (category === PUSH_CATEGORY_CONFLICT) return [PUSH_ACTION_RESCHEDULE];
  if (category === PUSH_CATEGORY_PLAN_OFFER)
    return [PUSH_ACTION_KEEP, PUSH_ACTION_PREFER];
  if (category === PUSH_CATEGORY_SESSION_END)
    return [PUSH_ACTION_DONE, PUSH_ACTION_NOT_THIS_TIME];
  return [];
}



/**
 * Android channel id per tone. Channel sound is immutable once created, so
 * these are new ids (the legacy `"default"` channel keeps the system sound).
 * `-v2`: the first `zenflow-*` channels were created before the sound files
 * shipped in the native build, so they are stuck on the system sound.
 */
export function pushChannelId(tone: PushTone): string {
  return `zenflow-${tone}-v2`;
}

/** Bundled sound file name (iOS payload `sound`, expo-notifications local `sound`). */
export function pushSoundFile(tone: PushTone): string {
  return `zenflow_${tone}.wav`;
}

/** Which push provider a device token belongs to. Mirrors the Prisma enum. */
export type DevicePlatform = "IOS" | "ANDROID" | "WEB";

/**
 * Request body for `POST /devices` — register (or refresh) one device.
 * `p256dh` and `auth` are required (non-empty) when `platform` is `WEB`, and `null` otherwise.
 */
export interface RegisterDeviceInput {
  platform: DevicePlatform;
  /** FCM or APNs token; for WEB, the push subscription endpoint URL (https). */
  pushToken: string;
  p256dh: string | null;
  auth: string | null;
}

/** Request body for `DELETE /devices` — unregister one device by its token. */
export interface UnregisterDeviceInput {
  pushToken: string;
}

/** `data` payload for `POST /devices`. */
export interface RegisterDeviceResponse {
  id: string;
}

/**
 * The string map delivered alongside a push, for the app to route on when the
 * notification is tapped. FCM `data` values must be strings; the APNs custom
 * payload mirrors this shape for parity, so every value here is a string —
 * `sessionId` is `""` (not omitted) when the notification has no session.
 */
export interface PushDataPayload {
  notificationId: string;
  /** The notification's `eventName` slug, for the app to classify without a round-trip. */
  eventName: string;
  sessionId: string;
  /** A plan offer's proposal, or `""`. Keep and Prefer map to its two times. */
  slotProposalId: string;
  /** In-app path to open — `"/calendar?session=<id>"` or `"/notifications"`. */
  url: string;
}
