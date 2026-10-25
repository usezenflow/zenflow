import { DAILY_HORIZON, SLOT_MINUTES } from "@zenflow/shared";

export const minutesToTime = (minutes: number): string => {
  if (minutes === DAILY_HORIZON) return "11:59 PM";
  const totalHours = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hours = totalHours % 12 === 0 ? 12 : totalHours % 12;
  const ampm = totalHours >= 12 ? "PM" : "AM";
  return `${hours}:${m.toString().padStart(2, "0")} ${ampm}`;
};

export const minutesToHour = (minutes: number): string => {
  if (minutes === DAILY_HORIZON) return "11:59 PM";
  const totalHours = Math.floor(minutes / 60);
  const hours = totalHours % 12 === 0 ? 12 : totalHours % 12;
  const ampm = totalHours >= 12 ? "PM" : "AM";
  return `${hours} ${ampm}`;
};

export const formatMinutes = (totalMinutes: number): string => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const hourWord = " h";
  const minuteWord = " min";
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}${hourWord}`);
  if (minutes > 0) parts.push(`${minutes}${minuteWord}`);
  return parts.length > 0 ? parts.join(" ") : "0" + minuteWord;
};

export const snapToNearestLaterQuarterHour = (minutes: number): number => {
  const remainder = minutes % SLOT_MINUTES;
  return minutes + SLOT_MINUTES - remainder;
};
