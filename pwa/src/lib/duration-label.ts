import { locale } from "@/lib/i18n";

/** Readout for a duration in minutes, in the app's language: `2 hours 30 mins`, `2 giờ 30 phút`. */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (locale() === "vi-VN") {
    return [hours ? `${hours} giờ` : "", mins ? `${mins} phút` : ""].filter(Boolean).join(" ");
  }
  return [
    hours ? (hours === 1 ? "1 hour" : `${hours} hours`) : "",
    mins ? `${mins} mins` : "",
  ]
    .filter(Boolean)
    .join(" ");
}
