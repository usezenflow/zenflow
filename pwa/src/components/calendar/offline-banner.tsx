import { t } from "@/lib/i18n";
import { CloudOff } from "lucide-react";

/** Shown while the calendar is read from saved data. Edits are unavailable. */
export function OfflineBanner() {
  return (
    <div
      role="status"
      className="flex animate-in fade-in slide-in-from-top-1 items-center gap-2 border-b border-border bg-muted px-4 py-2 text-[13px] text-muted-foreground"
    >
      <CloudOff className="size-4 shrink-0" />
      {t("Offline, showing saved sessions")}
    </div>
  );
}
