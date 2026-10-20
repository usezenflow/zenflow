import { zonedDate } from "@zenflow/core";
import { differenceInCalendarDays, format as dateFormat } from "date-fns";
import { dateFnsLocale, getLanguage, locale, t } from "@/lib/i18n";

/** Locale-sensitive display formatting. English keeps 12-hour AM/PM; Vietnamese reads 24-hour. */
export function format(
  date: Parameters<typeof dateFormat>[0],
  pattern: string,
  options?: Parameters<typeof dateFormat>[2],
) {
  const displayPattern =
    getLanguage() === "vi"
      ? pattern
          .replace("'on'", "'ngày'")
          // A bare month header reads "tháng 10/2026" (`formatTitle` capitalises it).
          .replace(/^MMMM yyyy$/, "'tháng' M/yyyy")
          .replace(/h:mm a/g, "HH:mm")
          .replace(/h a/g, "HH")
          .replace(/h:mm/g, "HH:mm")
          .replace(/EEE d MMM/g, "EEE, d/M")
          .replace(/d MMM yyyy/g, "d/M/yyyy")
          .replace(/EEE MMM d/g, "EEE, d/M")
          .replace(/MMM d yyyy/g, "d/M/yyyy")
          .replace(/MMMM d/g, "d MMMM")
          .replace(/MMM d/g, "d/M")
      : pattern.replace(/HH:mm/g, "h:mm a");
  return dateFormat(date, displayPattern, { ...options, locale: dateFnsLocale() });
}

/** `format` for standalone labels (headers, titles): Vietnamese month and day names come back lowercase. */
export function formatTitle(...args: Parameters<typeof format>) {
  const text = format(...args);
  return text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1);
}

/** An hour as a grid label: `3AM`, `10PM` in English; `3h`, `18h` in Vietnamese. */
export function hourLabel(hour: number) {
  if (getLanguage() === "vi") return `${hour}h`;
  return `${hour % 12 || 12}${hour < 12 ? "AM" : "PM"}`;
}

/** A deadline with its exact time, so 0:00 and 23:59 read differently. */
export function localizedDeadlineExact(deadline: string, tz: string, ref: Date): string {
  const due = zonedDate(deadline, tz);
  const anchor = zonedDate(ref, tz);
  const days = differenceInCalendarDays(due, anchor);
  const day =
    days === 0
      ? t("Today")
      : days === 1
        ? t("Tomorrow")
        : format(due, due.getFullYear() === anchor.getFullYear() ? "EEE MMM d" : "MMM d yyyy");
  return `${day}, ${format(due, "HH:mm")}`;
}

/** A short deadline label: a time for today, the day otherwise. */
export function localizedDeadlineShort(deadline: string, tz: string, ref: Date): string {
  const due = zonedDate(deadline, tz);
  const anchor = zonedDate(ref, tz);
  const days = differenceInCalendarDays(due, anchor);
  if (days === 0) return format(due, "h:mm a");
  if (days === 1) return t("Tomorrow");
  return format(due, due.getFullYear() === anchor.getFullYear() ? "MMM d" : "MMM d yyyy");
}
