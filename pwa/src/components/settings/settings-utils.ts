import { locale } from "@/lib/i18n";

/** Share of the quota at which storage starts warning. */
const STORAGE_WARN_RATIO = 0.8;

export type StorageLevel = "ok" | "warn" | "full";

/** Bar fill (0-100) and warning level for `usedBytes` of `quotaBytes`. */
export function storageUsage(
  usedBytes: number,
  quotaBytes: number,
): { percent: number; level: StorageLevel } {
  if (!(quotaBytes > 0)) return { percent: 0, level: "ok" };
  const ratio = Math.max(0, usedBytes) / quotaBytes;
  const level: StorageLevel =
    ratio >= 1 ? "full" : ratio >= STORAGE_WARN_RATIO ? "warn" : "ok";
  return { percent: Math.min(100, Math.round(ratio * 100)), level };
}

const UNITS = ["B", "KB", "MB", "GB"];

/** "812 B", "4.2 KB", "13 MB", "1.5 GB": one decimal below 10, none above. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} ${UNITS[0]}`;
  const text =
    value < 10 ? value.toLocaleString(locale(), { maximumFractionDigits: 1 }) : String(Math.round(value));
  return `${text} ${UNITS[unit]}`;
}

/** "New User" -> "NU". */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0));
  const picked =
    letters.length > 1
      ? [letters[0], letters[letters.length - 1]]
      : letters.slice(0, 1);
  return picked.join("").toUpperCase() || "?";
}

/** "alice@zenflow.com" -> "a••••@zenflow.com". */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain || local.length <= 1) return email;
  return `${local[0]}${"•".repeat(Math.max(local.length - 1, 3))}@${domain}`;
}

const STUDENT_EMAIL = /^\s*(\d+)@dlu\.edu\.vn\s*$/i;

/** The student ID in a student address; empty for any other address. */
export function studentIdOf(email: string | undefined): string {
  return STUDENT_EMAIL.exec(email ?? "")?.[1] ?? "";
}

/** Fixed-point number for display; empty for null. */
export function fixed(value: number | null, digits = 2): string {
  return value === null ? "" : value.toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

