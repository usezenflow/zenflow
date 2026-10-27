import { t } from "@/lib/i18n";
import { debugLog } from "@/lib/debug-log";
import { extractServerMessage } from "@/lib/save-error";
import { isAxiosError } from "axios";

/** Logs a failed call (`[zf] palette.<where>` in Metro) and returns a short reason for the toast. */
export function reportError(where: string, error: unknown): string {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    const message = extractServerMessage(error.response?.data) ?? error.message;
    debugLog(`palette.${where}`, {
      status,
      code: error.code,
      method: error.config?.method,
      url: error.config?.url,
      message,
    });
    return [
      status ?? error.code,
      error.config?.method?.toUpperCase(),
      error.config?.url,
      message,
    ]
      .filter(Boolean)
      .join(" ");
  }
  const message = error instanceof Error ? error.message : String(error);
  debugLog(`palette.${where}`, message);
  return message;
}

/** A bulk item's failure in the app language; the server text is English. */
export function itemError(r: { code: string }): string {
  return r.code === "SCHEDULE_INFEASIBLE" ||
    r.code === "PLACEMENT_NEEDS_CONFIRMATION"
    ? t("No free slot")
    : t("Could not add this task");
}
