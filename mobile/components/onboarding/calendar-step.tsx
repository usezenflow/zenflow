import { Bell, CalendarDays, Smartphone } from "@/components/Icons";
import { useToast } from "@/components/ui/toast";
import { useDeviceCalendar } from "@/hooks/use-device-calendar";
import { useLanguage } from "@/hooks/use-language";
import { deviceCalendarSupported } from "@/lib/device-calendar/supported";
import { t } from "@/lib/i18n";
import { Linking, View } from "react-native";
import { ConnectTile } from "./connect-tile";

/** Phone calendar and reminders: one tap each. */
export function CalendarStep({
  notificationsOn,
  blocked,
  busy,
  onEnableNotifications,
}: {
  notificationsOn: boolean;
  blocked: boolean;
  busy: boolean;
  onEnableNotifications: () => void;
}) {
  useLanguage();
  const { toast } = useToast();
  const phone = useDeviceCalendar((s) => s.state.enabled);
  const { enable, disable } = useDeviceCalendar.getState();
  async function togglePhone() {
    if (phone) return disable();
    const result = await enable();
    if (result === "denied") toast({ title: t("Calendar access is off"), variant: "destructive", icon: CalendarDays });
    else if (result !== "ok") toast({ title: t("Couldn't turn this on"), variant: "destructive", icon: CalendarDays });
  }

  return (
    <View className="gap-3">
      {deviceCalendarSupported() ? (
        <ConnectTile
          testID="onboarding.phone-calendar"
          icon={Smartphone}
          title={t("This phone")}
          hint={phone ? t("On") : undefined}
          state={phone ? "done" : "idle"}
          onPress={() => void togglePhone()}
        />
      ) : null}
      <ConnectTile
        testID="onboarding.notifications-switch"
        icon={Bell}
        title={t("Reminders")}
        hint={blocked ? t("Blocked") : notificationsOn ? t("On") : undefined}
        state={notificationsOn ? "done" : busy ? "busy" : "idle"}
        onPress={blocked ? () => void Linking.openSettings() : onEnableNotifications}
      />
    </View>
  );
}
