import { useEffect, useState } from "react";
import { AlertCircle, AlertTriangle, Database } from "lucide-react";
import type { FileUsage } from "@zenflow/shared";
import { getFileUsage } from "@/api/storage";
import { Skeleton } from "@/components/ui/skeleton";
import { IconTile, SettingsCard, SettingsLabel } from "@/components/settings/settings-ui";
import { formatBytes, storageUsage, type StorageLevel } from "@/components/settings/settings-utils";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const BAR: Record<StorageLevel, string> = {
  ok: "bg-primary",
  warn: "bg-session-conflict",
  full: "bg-destructive",
};

const CALLOUT: Record<Exclude<StorageLevel, "ok">, string> = {
  warn: "border-session-conflict/40 bg-session-conflict/20 text-session-conflict-ink",
  full: "border-destructive/30 bg-destructive/10 text-destructive",
};

/** Share of the user's file quota in use, with a warning near the limit and the per-file cap. */
export function StorageSection() {
  useLanguage();
  const [usage, setUsage] = useState<FileUsage | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getFileUsage()
      .then((next) => {
        if (active) setUsage(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const { percent, level } = usage
    ? storageUsage(usage.usedBytes, usage.userQuotaBytes)
    : { percent: 0, level: "ok" as const };

  return (
    <>
      <SettingsLabel>{t("Storage")}</SettingsLabel>
      <SettingsCard className="px-4 py-3.5">
        <div className="flex items-center gap-3.5">
          <IconTile icon={Database} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">{t("File storage")}</p>
            {usage ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t("{used} of {total} used", {
                  used: formatBytes(usage.usedBytes),
                  total: formatBytes(usage.userQuotaBytes),
                })}
              </p>
            ) : failed ? (
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {navigator.onLine ? t("Couldn't load your usage.") : t("Usage is unavailable offline.")}
              </p>
            ) : (
              <Skeleton className="mt-1.5 h-3 w-1/2" />
            )}
          </div>
          {usage ? <span className="text-[15px] font-medium text-muted-foreground">{percent}%</span> : null}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted"
        >
          {usage ? (
            <div
              className={cn("h-full rounded-full", BAR[level])}
              style={{ width: `${Math.max(percent, usage.usedBytes > 0 ? 2 : 0)}%` }}
            />
          ) : null}
        </div>
        {usage ? (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("Each file can be up to {size} MB.", {
              size: Math.round(usage.maxFileBytes / (1024 * 1024)),
            })}
          </p>
        ) : null}
        {usage && level !== "ok" ? (
          <div className={cn("mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5", CALLOUT[level])}>
            {level === "full" ? (
              <AlertCircle className="mt-px size-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-px size-4 shrink-0" />
            )}
            <p className="flex-1 text-[13px] font-medium">
              {level === "full"
                ? t("Storage full. Remove files from your notes to upload more.")
                : t("Almost full. Remove files from your notes to free up space.")}
            </p>
          </div>
        ) : null}
      </SettingsCard>
    </>
  );
}
