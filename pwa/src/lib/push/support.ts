/** Web Push needs a service worker and PushManager. */
export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/**
 * iOS delivers web push only to an app installed on the home screen (iOS
 * 16.4+), so a browser tab on iOS is unsupported until it is installed.
 */
export function needsHomeScreenInstall(): boolean {
  if (isPushSupported()) return false;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/** The OS-level permission, or `null` when push is unsupported. */
export function readPushPermission(): NotificationPermission | null {
  return isPushSupported() ? Notification.permission : null;
}
