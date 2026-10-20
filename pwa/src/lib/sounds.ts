import zenflowDefault from "@zenflow/brand/sounds/zenflow_default.wav?url";
import zenflowReminder from "@zenflow/brand/sounds/zenflow_reminder.wav?url";
import zenflowUrgent from "@zenflow/brand/sounds/zenflow_urgent.wav?url";
import type { PushTone } from "@zenflow/shared";

const CHIMES: Record<PushTone, string> = {
  default: zenflowDefault,
  reminder: zenflowReminder,
  urgent: zenflowUrgent,
};

/**
 * Plays a Zenflow chime while the app is open. Browsers block audio until
 * the first tap, and then the chime is skipped without an error.
 * Web push cannot set a custom sound: the operating system plays its own.
 */
export function playChime(tone: PushTone): void {
  void new Audio(CHIMES[tone]).play().catch(() => {});
}
