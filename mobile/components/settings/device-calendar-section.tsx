import { CalendarDays, Info, RefreshCw } from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { shortAgo } from "@/components/settings/dlu-accounts-section";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useDeviceCalendar } from "@/hooks/use-device-calendar";
import { deviceCalendarSupported } from "@/lib/device-calendar/supported";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { View } from "react-native";

function lastSyncLabel(syncedAt: number | null): string {
  if (!syncedAt) return t("Not synced yet");
  return t("Synced {time}", { time: shortAgo(new Date(syncedAt).toISOString()) });
}

/** Settings "Phone calendar": writes the schedule into a Zenflow calendar in the phone's own calendar app. */
export function DeviceCalendarSection() {
  useLanguage();
  const { toast } = useToast();
  const state = useDeviceCalendar((s) => s.state);
  const syncing = useDeviceCalendar((s) => s.syncing);
  const { enable, disable, syncNow } = useDeviceCalendar.getState();

  if (!deviceCalendarSupported()) return null;

  async function toggle(on: boolean) {
    if (!on) return disable();
    const result = await enable();
    if (result === "ok") return;
    const failure = {
      denied: [t("Calendar access is off"), t("Allow it in your phone's settings to use this.")],
      failed: [t("Couldn't turn this on"), t("Try again in a moment.")],
    }[result];
    toast({ title: failure[0], description: failure[1], variant: "destructive", icon: CalendarDays });
  }

  return (
    <>
      <SettingsSectionLabel>{t("Phone calendar")}</SettingsSectionLabel>
      {state.enabled ? (
        <Notice
          testID="device-calendar.note"
          tone="info"
          icon={Info}
          className="mb-2"
          title={t("Turn on all calendars")}
          detail={t("In your calendar app, show every Zenflow calendar so no event is hidden.")}
        />
      ) : null}
      <View className="overflow-hidden rounded-2xl border border-border bg-card px-4 py-3.5">
        <View className="flex-row items-center gap-[13px]">
          <View
            className={cn(
              "size-[38px] shrink-0 items-center justify-center rounded-xl",
              state.enabled ? "bg-brand-lime/25 dark:bg-brand-lime/40" : "bg-muted",
            )}
          >
            <CalendarDays
              size={18}
              className={state.enabled ? "text-brand-lime" : "text-foreground"}
            />
            {state.enabled ? (
              <View className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-brand-lime/70 dark:bg-brand-lime" />
            ) : null}
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-[16px] font-semibold">{t("Show in my calendar app")}</Text>
            <Text
              className={cn(
                "text-[13px] leading-[18px]",
                state.enabled ? "text-brand-lime" : "text-muted-foreground",
              )}
            >
              {!state.enabled
                ? t("Zenflow events appear in your phone's calendar.")
                : syncing
                  ? t("Syncing…")
                  : lastSyncLabel(state.syncedAt)}
            </Text>
          </View>
          <Switch
            testID="device-calendar.toggle"
            checked={state.enabled}
            onCheckedChange={(on) => void toggle(on)}
          />
        </View>
        {state.enabled ? (
          <View className="mt-2.5 flex-row pl-[51px]">
            <Button
              testID="device-calendar.sync"
              size="sm"
              className="flex-row items-center gap-1.5 rounded-full"
              disabled={syncing}
              onPress={() => void syncNow(true)}
              accessibilityLabel={t("Sync now")}
            >
              <RefreshCw size={14} className="text-primary-foreground" />
              <Text className="text-[13px] font-semibold text-primary-foreground">
                {syncing ? t("Syncing…") : t("Sync now")}
              </Text>
            </Button>
          </View>
        ) : null}
      </View>
    </>
  );
}
