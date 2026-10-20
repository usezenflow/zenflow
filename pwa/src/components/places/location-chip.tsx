import { Globe, MapPin } from "lucide-react";
import { isOnlineLocation } from "@zenflow/core";
import { Glass } from "@/components/ui/glass";
import { useLanguage, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Where a session is held: a pin and the room, or a globe and "Online" for a link. */
export function LocationChip({ location, compact = false }: { location: string; compact?: boolean }) {
  useLanguage();
  const online = isOnlineLocation(location);
  const Icon = online ? Globe : MapPin;
  return (
    <Glass
      frosted
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground",
        compact ? "max-w-[200px] gap-1 px-2 py-0.5 text-[11px] leading-[14px]" : "max-w-[260px]",
      )}
    >
      <Icon className={cn("shrink-0", compact ? "size-2.5" : "size-3")} />
      <span className="min-w-0 truncate">{online ? t("Online") : location}</span>
    </Glass>
  );
}
