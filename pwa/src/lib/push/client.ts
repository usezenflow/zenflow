import { registerDevice, unregisterDevice } from "@/api/devices";
import { updateBasicInfo } from "@/api/users";
import { useUserStore } from "@/hooks/use-user-store";
import { isPushSupported, readPushPermission } from "@/lib/push/support";

/** Outcome of turning notifications on. */
export type EnableResult = "on" | "denied" | "unsupported" | "failed";

/** The VAPID public key is not secret; it ships with the build (VITE_VAPID_PUBLIC_KEY). */
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

/** Base64url (RFC 4648 §5) to bytes, as `pushManager.subscribe` expects the VAPID key. */
function vapidKeyBytes(base64Url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function keyToBase64Url(key: ArrayBuffer | null): string {
  if (!key) return "";
  let binary = "";
  for (const byte of new Uint8Array(key)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The active service worker registration, or a rejection when none exists (dev, unsupported). */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    throw new Error("Service worker is not registered");
  }
  return navigator.serviceWorker.ready;
}

/** Subscribes this browser (reusing an existing subscription) and registers it with the API. */
async function registerThisBrowser(): Promise<void> {
  const registration = await readyRegistration();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes(VAPID_PUBLIC_KEY),
    });
  }
  await registerDevice({
    platform: "WEB",
    pushToken: subscription.endpoint,
    p256dh: keyToBase64Url(subscription.getKey("p256dh")),
    auth: keyToBase64Url(subscription.getKey("auth")),
  });
}

/** Removes this browser's device row and push subscription. */
async function removeThisBrowser(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await unregisterDevice({ pushToken: subscription.endpoint });
  await subscription.unsubscribe();
}

async function saveAllowNotifications(allowNotifications: boolean): Promise<void> {
  useUserStore.getState().setUser(await updateBasicInfo({ allowNotifications }));
}

/**
 * Asks for permission if it is still undecided, then subscribes and saves
 * `allowNotifications: true`. Only a user gesture should call this.
 */
export async function turnOnNotifications(): Promise<EnableResult> {
  if (!isPushSupported()) return "unsupported";
  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") {
    if (permission === "denied") await saveAllowNotifications(false).catch(() => {});
    return "denied";
  }
  try {
    await registerThisBrowser();
    await saveAllowNotifications(true);
    return "on";
  } catch {
    return "failed";
  }
}

/** Saves `allowNotifications: false` first, so sends stop even if the device cleanup fails. */
export async function turnOffNotifications(): Promise<void> {
  await saveAllowNotifications(false);
  await removeThisBrowser().catch(() => {});
}

/** Sign out: removes this browser's device row. The preference is kept for the next login. */
export async function unregisterOnSignOut(): Promise<void> {
  if (!isPushSupported()) return;
  await removeThisBrowser().catch(() => {});
}

/** Re-registers this browser when notifications are on and permission is already granted. Never prompts. */
export async function syncPushForUser(allowNotifications: boolean): Promise<void> {
  if (!allowNotifications || readPushPermission() !== "granted") return;
  await registerThisBrowser().catch(() => {});
}
