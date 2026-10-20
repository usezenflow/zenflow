import { AlarmClock, Bell, ChevronRight, GraduationCap } from "lucide-react";
import { t, useLanguage } from "@/lib/i18n";

export type SetupItem = "notifications" | "dlu";

/** Steps skipped during onboarding, derived from real state so each row disappears once done. */
export function FinishSetupCard({
  notificationsActive,
  dluConnected,
  onPress,
}: {
  notificationsActive: boolean;
  dluConnected: boolean;
  onPress: (item: SetupItem) => void;
}) {
  useLanguage();
  const items: SetupItem[] = [];
  if (!notificationsActive) items.push("notifications");
  if (!dluConnected) items.push("dlu");
  if (items.length === 0) return null;

  const copy: Record<SetupItem, { title: string; Icon: typeof Bell }> = {
    notifications: { title: t("Allow notifications"), Icon: Bell },
    dlu: { title: t("Connect your LMS or portal"), Icon: GraduationCap },
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/40 bg-primary/10">
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <div className="flex items-center gap-2">
          <AlarmClock className="size-4 text-primary" />
          <span className="text-[15px] font-bold">{t("Finish setting up Zenflow")}</span>
        </div>
        <span className="text-[13px] text-muted-foreground">
          {t("{count} left", { count: items.length })}
        </span>
      </div>
      {items.map((item) => {
        const { title, Icon } = copy[item];
        return (
          <button
            key={item}
            type="button"
            onClick={() => onPress(item)}
            className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-muted/50"
          >
            <Icon className="size-[18px] text-foreground" />
            <span className="flex-1 text-[15px] font-semibold">{title}</span>
            <ChevronRight className="size-[18px] text-muted-foreground" />
          </button>
        );
      })}
    </div>
  );
}
