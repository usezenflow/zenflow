import { startGoogleCalendar, getGoogleCalendar } from "@/api/google-calendar";
import { Bell, CalendarDays, Smartphone } from "@/components/Icons";
import { useToast } from "@/components/ui/toast";
import { useDeviceCalendar } from "@/hooks/use-device-calendar";
import { useLanguage } from "@/hooks/use-language";
import { deviceCalendarSupported } from "@/lib/device-calendar/supported";
import { t } from "@/lib/i18n";
import type { GoogleCalendarStatus } from "@zenflow/shared";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, View } from "react-native";
import { ConnectTile } from "./connect-tile";

/** Phone calendar (no sign-in), Google Calendar, reminders: one tap each. */
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
  const [google, setGoogle] = useState<GoogleCalendarStatus | null | undefined>(undefined);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => {
    getGoogleCalendar().then(setGoogle, () => setGoogle(null));
  }, []);

  useEffect(() => {
    load();
    // Back from the browser sign-in.
    const sub = AppState.addEventListener("change", (s) => s === "active" && load());
    return () => sub.remove();
  }, [load]);

  const linked = !!google?.connected && google.state !== "NEEDS_RECONNECT";
  const googleOff = google === null || (!!google && !google.available) || phone;

  async function togglePhone() {
    if (phone) return disable();
    const result = await enable();
    if (result === "denied") toast({ title: t("Calendar access is off"), variant: "destructive", icon: CalendarDays });
    else if (result !== "ok") toast({ title: t("Couldn't turn this on"), variant: "destructive", icon: CalendarDays });
  }

  async function connectGoogle() {
    setStarting(true);
    try {
      await Linking.openURL((await startGoogleCalendar()).url);
    } catch {
      toast({ title: t("Couldn't connect Google Calendar"), variant: "destructive", icon: CalendarDays });
    } finally {
      setStarting(false);
    }
  }

  return (
    <View className="gap-3">
      {deviceCalendarSupported() ? (
        <ConnectTile
          testID="onboarding.phone-calendar"
          icon={Smartphone}
          title={t("This phone")}
          hint={phone ? t("On") : undefined}
          state={phone ? "done" : linked ? "off" : "idle"}
          onPress={() => void togglePhone()}
        />
      ) : null}
      <ConnectTile
        icon={CalendarDays}
        title={t("Google Calendar")}
        hint={google === null || (google && !google.available) ? t("Not available") : linked ? t("Connected") : undefined}
        state={linked ? "done" : googleOff ? "off" : starting || google === undefined ? "busy" : "idle"}
        onPress={() => void connectGoogle()}
      />
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
