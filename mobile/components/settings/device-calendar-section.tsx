import { CalendarDays, RefreshCw } from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useDeviceCalendar } from "@/hooks/use-device-calendar";
import { deviceCalendarSupported } from "@/lib/device-calendar/supported";
import { useLanguage } from "@/hooks/use-language";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t } from "@/lib/i18n";
import { Pressable, View } from "react-native";

function lastSyncLabel(syncedAt: number | null, timeZone: string): string {
  if (!syncedAt) return t("Not synced yet");
  const when = new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(syncedAt),
  );
  return t("Last synced {when}", { when });
}

/** Settings "Phone calendar": writes the schedule into a Zenflow calendar in the phone's own calendar app. */
export function DeviceCalendarSection() {
  useLanguage();
  const { toast } = useToast();
  const timeZone = useUserStore((s) => s.user?.timezone) || "UTC";
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
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <View className="flex-row items-center gap-[13px] px-4 py-3.5">
          <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <CalendarDays size={18} className="text-foreground" />
          </View>
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="text-[16px] font-semibold">{t("Show in my calendar app")}</Text>
            <Text className="text-[13px] leading-[18px] text-muted-foreground">
              {t("Zenflow events appear in your phone's calendar.")}
            </Text>
          </View>
          <Switch
            testID="device-calendar.toggle"
            checked={state.enabled}
            onCheckedChange={(on) => void toggle(on)}
          />
        </View>
        {state.enabled ? (
          <Pressable
            testID="device-calendar.sync"
            onPress={() => void syncNow(true)}
            disabled={syncing}
            className="flex-row items-center gap-2 border-t border-border px-4 py-3 active:opacity-70"
          >
            <RefreshCw size={16} className="text-primary" />
            <Text className="flex-1 text-[14px] font-semibold text-primary">
              {syncing ? t("Syncing") : t("Sync now")}
            </Text>
            <Text className="text-[12px] text-muted-foreground">{lastSyncLabel(state.syncedAt, timeZone)}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
