import { locale, t } from "@/lib/i18n";
import { reminderLabel, reminderLeadLabel } from "@zenflow/core";

/** Lead time in the app's language: "At start", "15 min", "2 hours". */
export function localizedReminderLeadLabel(minutes: number): string {
  if (locale() !== "vi-VN") return reminderLeadLabel(minutes);
  if (minutes === 0) return t("At start");
  const unit =
    minutes % 10080 === 0
      ? 10080
      : minutes % 1440 === 0
        ? 1440
        : minutes % 60 === 0
          ? 60
          : 1;
  const word =
    unit === 10080 ? "week" : unit === 1440 ? "day" : unit === 60 ? "hour" : "min";
  return `${minutes / unit} ${t(word)}`;
}

/** Chip text: "At start time", "1 hour before" (VI: "Trước 1 giờ"). */
export function localizedReminderLabel(minutes: number): string {
  if (locale() !== "vi-VN") return reminderLabel(minutes);
  return minutes === 0
    ? t("At start time")
    : t("Before {lead}", { lead: localizedReminderLeadLabel(minutes) });
}
