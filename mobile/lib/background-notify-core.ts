import type { NotificationDto } from "@zenflow/shared";

/**
 * Unread rows raised after `since`. With no baseline yet, nothing: the first
 * run only seeds the baseline so an old inbox doesn't fire all at once.
 */
export function unseenNotifications(
  items: NotificationDto[],
  since: string | null,
): NotificationDto[] {
  if (!since) return [];
  const cutoff = Date.parse(since);
  return items.filter((n) => !n.readAt && Date.parse(n.sentAt) > cutoff);
}

/** Newest instant of `a` and `b` (ISO-8601); `b` may be null. */
export function latestInstant(a: string, b: string | null): string {
  return b && Date.parse(b) > Date.parse(a) ? b : a;
}
