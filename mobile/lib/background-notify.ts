import { listNotifications } from "@/api/notifications";
import { restoreSessionCookie } from "@/lib/api-client";
import { debugLog } from "@/lib/debug-log";
import { latestInstant, unseenNotifications } from "@/lib/background-notify-core";
import { pushCategoryFor, pushSoundFile, pushToneFor } from "@zenflow/shared";
import * as BackgroundTask from "expo-background-task";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

/**
 * iOS without APNs (a free Apple ID, e.g. SideStore, cannot carry the push
 * entitlement): poll the inbox in the background and post local notifications.
 * Best effort. iOS runs the task when it chooses, at most every 30 minutes.
 */
export const usesLocalPoll =
  Platform.OS === "ios" && Constants.expoConfig?.extra?.iosRemotePush !== true;

const TASK = "zenflow-notify-poll";
const SEEN_KEY = "zenflow.notify.seen";

async function markSeen(sentAt: string) {
  const prev = await SecureStore.getItemAsync(SEEN_KEY);
  await SecureStore.setItemAsync(SEEN_KEY, latestInstant(sentAt, prev));
}

/** Foreground paths that already presented a row call this so the poll skips it. */
export function markNotificationSeen(sentAt: string) {
  if (usesLocalPoll) void markSeen(sentAt).catch(() => {});
}

if (usesLocalPoll) {
  TaskManager.defineTask(TASK, async () => {
    try {
      await restoreSessionCookie();
      const { notifications } = await listNotifications({ limit: 50 });
      const since = await SecureStore.getItemAsync(SEEN_KEY);
      for (const n of unseenNotifications(notifications, since)) {
        const tone = pushToneFor(n.eventName);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: n.title.replace(/^\[.*?\]\s*/, "").trim() || n.title,
            body: n.content,
            categoryIdentifier: pushCategoryFor(n.eventName) ?? undefined,
            data: {
              sessionId: n.sessionId,
              notificationId: n.id,
              eventName: n.eventName,
            },
            sound: pushSoundFile(tone),
          },
          trigger: null,
        });
      }
      if (notifications[0]) await markSeen(notifications[0].sentAt);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (err) {
      debugLog("push", `poll failed: ${String(err)}`);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function startLocalPoll(): Promise<void> {
  try {
    if (!(await SecureStore.getItemAsync(SEEN_KEY))) {
      await SecureStore.setItemAsync(SEEN_KEY, new Date().toISOString());
    }
    if (await TaskManager.isTaskRegisteredAsync(TASK)) return;
    await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 30 });
  } catch (err) {
    debugLog("push", `poll start failed: ${String(err)}`);
  }
}

export async function stopLocalPoll(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(TASK)) {
      await BackgroundTask.unregisterTaskAsync(TASK);
    }
  } catch (err) {
    debugLog("push", `poll stop failed: ${String(err)}`);
  }
}
