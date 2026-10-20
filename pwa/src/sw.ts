/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import {
  type PrecacheEntry,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

/**
 * Service worker: precache, offline app shell and web push. Built by
 * vite-plugin-pwa (`injectManifest`), registered from `main.tsx`, and never
 * registered in dev.
 *
 * iOS delivers web push only to an app installed on the home screen (16.4+).
 */

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

/** Payload from `PushService` (backend `devices`): `notification` for display, `data` for routing. */
interface PushPayload {
  notification?: { title?: string; body?: string };
  data?: { notificationId?: string; url?: string };
}

const FALLBACK_URL = "/";

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);
// Offline: any navigation falls back to the precached app shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

function readPayload(data: PushMessageData | null): PushPayload {
  try {
    return data?.json() ?? {};
  } catch {
    return {};
  }
}

/** Same-origin URL for `raw`, else the notifications page. */
function safeUrl(raw: unknown): string {
  const url = new URL(typeof raw === "string" ? raw : FALLBACK_URL, self.location.origin);
  return url.origin === self.location.origin ? url.href : new URL(FALLBACK_URL, self.location.origin).href;
}

async function openInApp(url: string): Promise<void> {
  const windows = (
    await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  ).filter((client): client is WindowClient => client.type === "window");
  const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
  if (!client) {
    await self.clients.openWindow(url);
    return;
  }
  await client.focus();
  try {
    await client.navigate(url);
  } catch {
    await self.clients.openWindow(url);
  }
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event.data);
  event.waitUntil(
    self.registration.showNotification(payload.notification?.title || "Zenflow", {
      body: payload.notification?.body,
      tag: payload.data?.notificationId,
      icon: "/logo.svg",
      data: { url: safeUrl(payload.data?.url) },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openInApp(safeUrl(event.notification.data?.url)));
});
