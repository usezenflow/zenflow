import { registerDevice, unregisterDevice } from "@/api/devices";
import { debugLog } from "@/lib/debug-log";
import type { PushPermission } from "@/lib/push-sync";
import {
  type DevicePlatform,
  type PushDataPayload,
  type PushTone,
  PUSH_ACTION_KEEP,
  PUSH_ACTION_PREFER,
  PUSH_ACTION_RESCHEDULE,
  PUSH_CATEGORY_CONFLICT,
  PUSH_CATEGORY_PLAN_OFFER,
  pushChannelId,
  pushSoundFile,
} from "@zenflow/shared";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import type { Href } from "expo-router";
import { sessionEditHref } from "@/lib/session-detail";
import { Linking, Platform } from "react-native";
import { NTFY_STORE_URL, ntfySubscribeUrl, topicFromBytes } from "./ntfy";
import { t } from "./i18n";

/**
 * Delivery runs through ntfy: the backend publishes to this device's topic and
 * the ntfy app shows it. `expo-notifications` stays for permission, Android
 * channels and the notifications the SSE stream posts while the app runs.
 *
 * Everything is a no-op on web and fails soft.
 */

/**
 * `data.source` on the system notification the SSE handler posts itself
 * (`hooks/use-notifications.ts`), so the foreground push listener can tell it
 * from a server push and not toast it a second time.
 */
export const LOCAL_NOTIFICATION_SOURCE = "sse-local";

// One backend notification reaches a foregrounded app twice — over the SSE
// stream and as a native push (`PushService` fans out the same event) — and
// both carry its `notificationId`. Whichever channel arrives first claims the
// id and is the only one presented; the other is swallowed.
const claimedBy = new Map<string, string>();
const CLAIM_CAP = 200;

/**
 * `true` if `owner` may present notification `id`: nobody claimed it yet, or
 * `owner` already did (the push handler and the push listener both see the
 * same push, so each passes the push's own request identifier as `owner`).
 */
export function claimNotification(
  id: string | undefined | null,
  owner: string,
): boolean {
  if (!id) return true;
  const current = claimedBy.get(id);
  if (current !== undefined) return current === owner;
  claimedBy.set(id, owner);
  if (claimedBy.size > CLAIM_CAP) {
    claimedBy.delete(claimedBy.keys().next().value as string);
  }
  return true;
}

/** Owner key for a native notification (its OS request identifier). */
export function pushOwner(n: Notifications.Notification): string {
  return `push:${n.request.identifier}`;
}

function notificationData(
  n: Notifications.Notification,
): Record<string, unknown> | undefined {
  return n.request.content.data as Record<string, unknown> | undefined;
}

/** The SSE handler's own system notification (never toasted again). */
export function isLocalNotification(n: Notifications.Notification): boolean {
  return notificationData(n)?.source === LOCAL_NOTIFICATION_SOURCE;
}

/** Backend `notificationId` a push/local notification carries, if any. */
export function notificationIdOf(
  n: Notifications.Notification,
): string | undefined {
  const id = notificationData(n)?.notificationId;
  return typeof id === "string" && id ? id : undefined;
}

/** How a foreground push is presented while the app is open. */
export function configureForegroundHandler(): void {
  // No native push on web (see file header) — `expo-notifications` has no
  // web shim for this call, and it runs at module scope (before any
  // Platform-gated effect), so an unguarded call here throws on import and
  // breaks the whole root layout's module evaluation on web.
  if (Platform.OS === "web") return;
  Notifications.setNotificationHandler({
    handleNotification: async (n) => {
      // A server push the SSE stream already presented (toast + its own
      // system notification) stays silent.
      const duplicate =
        !isLocalNotification(n) &&
        !claimNotification(notificationIdOf(n), pushOwner(n));
      return {
        // `shouldShowAlert` is deprecated in favor of the banner/list split
        // below (iOS 14+ distinguishes a foreground banner from the
        // notification-list entry) -- kept too since it's still read on
        // older platforms/typings that predate the split.
        shouldShowAlert: !duplicate,
        shouldShowBanner: !duplicate,
        shouldShowList: !duplicate,
        shouldPlaySound: !duplicate,
        shouldSetBadge: !duplicate,
      };
    },
  });
}

const TONES: PushTone[] = ["default", "urgent"];

/**
 * Android 8+ needs explicit channels or notifications are dropped silently.
 * One channel per Zenflow chime; sound is bound to the channel and immutable
 * after creation, hence the `zenflow-*` ids (the legacy `"default"` channel is
 * left alone).
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Promise.all(
    TONES.map((tone) =>
      Notifications.setNotificationChannelAsync(pushChannelId(tone), {
        name: t(tone === "urgent" ? "Urgent" : "General"),
        importance: Notifications.AndroidImportance.MAX,
        sound: pushSoundFile(tone),
        vibrationPattern:
          tone === "urgent" ? [0, 200, 120, 200] : [0, 250, 250, 250],
        lightColor: "#f97316",
        lockscreenVisibility:
          Notifications.AndroidNotificationVisibility.PUBLIC,
      }),
    ),
  );
}

/**
 * iOS action buttons, run in the background: the sync-conflict push gets one
 * "Reschedule", a plan offer gets its two times. Android shows no buttons on
 * FCM notification messages, so a tap there opens the inbox instead (see
 * `use-push-registration.ts`).
 */
export async function registerPushCategories(): Promise<void> {
  if (Platform.OS === "ios") {
    await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY_CONFLICT, [
      {
        identifier: PUSH_ACTION_RESCHEDULE,
        buttonTitle: t("Reschedule"),
        options: { opensAppToForeground: false },
      },
    ]);
    await Notifications.setNotificationCategoryAsync(PUSH_CATEGORY_PLAN_OFFER, [
      {
        identifier: PUSH_ACTION_KEEP,
        buttonTitle: t("Keep"),
        options: { opensAppToForeground: false },
      },
      {
        identifier: PUSH_ACTION_PREFER,
        buttonTitle: t("Prefer"),
        options: { opensAppToForeground: false },
      },
    ]);
  }
}

/**
 * Where a tapped notification should land. The backend's `PushDataPayload.url`
 * is web-shaped (`/calendar?session=…`), so route off `sessionId` instead and
 * reuse the same target the in-app inbox row uses.
 */
export function hrefFromPushData(
  data: Partial<PushDataPayload> | undefined,
): Href {
  const sessionId = data?.sessionId;
  if (sessionId) {
    return sessionEditHref(sessionId) as Href;
  }
  return "/notifications" as Href;
}

/** Current OS permission, normalized. Never prompts. `null` when unavailable. */
export async function readPermission(): Promise<PushPermission | null> {
  if (Platform.OS === "web") return null;
  try {
    return normalizePermission(await Notifications.getPermissionsAsync());
  } catch {
    return null;
  }
}

function normalizePermission(p: {
  granted: boolean;
  status: string;
  canAskAgain: boolean;
}): PushPermission {
  if (p.granted) return "granted";
  if (p.status === "undetermined") return "undetermined";
  return p.canAskAgain ? "denied" : "blocked";
}

/** Show the system prompt (no-op if the OS won't ask) and return the result. */
export async function requestPermission(): Promise<PushPermission | null> {
  if (Platform.OS === "web") return null;
  try {
    // Android 13+ shows no prompt (and the request can hang) until a channel exists.
    await ensureAndroidChannel().catch(() => {});
    const t0 = Date.now();
    debugLog("push", "requestPermissionsAsync: call");
    const result = normalizePermission(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowBadge: true, allowSound: true },
      }),
    );
    debugLog("push", `requestPermissionsAsync: ${result} +${Date.now() - t0}ms`);
    return result;
  } catch {
    return null;
  }
}

const TOPIC_KEY = "zenflow.ntfy.topic";

/** This device's ntfy topic: random, created once, kept in SecureStore. */
export async function getTopic(): Promise<string> {
  const saved = await SecureStore.getItemAsync(TOPIC_KEY);
  if (saved) return saved;
  const topic = topicFromBytes(Crypto.getRandomBytes(24));
  await SecureStore.setItemAsync(TOPIC_KEY, topic);
  return topic;
}

const ntfyBaseUrl = (): string =>
  process.env.EXPO_PUBLIC_NTFY_BASE_URL ??
  (Constants.expoConfig?.extra?.ntfyBaseUrl as string | undefined) ??
  "";

/** Open the ntfy app on this device's topic, or its store page when missing. */
export async function openNtfy(): Promise<void> {
  const url = ntfySubscribeUrl(ntfyBaseUrl(), await getTopic());
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(
      Platform.OS === "ios" ? NTFY_STORE_URL.ios : NTFY_STORE_URL.android,
    );
  }
}

/**
 * Register (upsert) this device's topic. Requires permission to already be
 * granted, never prompts. Returns true on success. `isCurrent` is re-checked
 * right before `POST /devices`, so a registration invalidated meanwhile
 * (toggle off / logout) never re-adds the topic.
 */
export async function registerThisDevice(
  isCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (Platform.OS === "web") return false;
  try {
    await ensureAndroidChannel();
    const platform: DevicePlatform = Platform.OS === "ios" ? "IOS" : "ANDROID";
    const topic = await getTopic();
    if (!isCurrent()) {
      debugLog("push", "register cancelled (superseded)");
      return false;
    }
    await registerDevice(platform, topic);
    debugLog("push", `registered ${platform} topic …${topic.slice(-6)}`);
    return true;
  } catch (err) {
    debugLog("push", `register failed: ${String(err)}`);
    return false;
  }
}

/**
 * Unregister this device (toggle off, or logout before the session cookie is
 * cleared). Best-effort, never blocks sign-out.
 */
export async function dropPushRegistration(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await unregisterDevice(await getTopic());
    debugLog("push", "unregistered this device");
  } catch (err) {
    debugLog("push", `unregister skipped: ${String(err)}`);
  }
}
