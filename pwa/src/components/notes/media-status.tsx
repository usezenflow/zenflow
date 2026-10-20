import { CloudOff } from "lucide-react";
import { useLanguage, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Label for a media item that can't play: offline, or the file failed to load. */
export function MediaStatus({
  offline,
  className,
}: {
  offline: boolean;
  className?: string;
}) {
  useLanguage();
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground",
        className,
      )}
    >
      <CloudOff className="size-3.5" aria-hidden />
      {offline ? t("Offline") : t("Couldn't load. Click to retry.")}
    </span>
  );
}
