import {
  disconnectGoogleCalendar,
  getGoogleCalendar,
  startGoogleCalendar,
  syncGoogleCalendar,
} from "@/api/google-calendar";
import { CalendarDays, RefreshCw } from "@/components/Icons";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useDeviceCalendar } from "@/hooks/use-device-calendar";
import { useLanguage } from "@/hooks/use-language";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t } from "@/lib/i18n";
import type { GoogleCalendarStatus } from "@zenflow/shared";
import { useCallback, useEffect, useState } from "react";
import { AppState, Linking, Pressable, View } from "react-native";

function lastSyncLabel(status: GoogleCalendarStatus, timeZone: string): string {
  if (!status.lastSyncedAt) return t("Not synced yet");
  const when = new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short", timeZone }).format(
    new Date(status.lastSyncedAt),
  );
  return t("Last synced {when}", { when });
}

/** Settings "Google Calendar": connect in the browser, sync, disconnect. Excludes the phone calendar. */
export function GoogleCalendarSection() {
  useLanguage();
  const { toast, confirm } = useToast();
  const timeZone = useUserStore((s) => s.user?.timezone) || "UTC";
  const [status, setStatus] = useState<GoogleCalendarStatus | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getGoogleCalendar().then(setStatus, () => setStatus(null));
  }, []);

  useEffect(() => {
    load();
    // Back from the browser sign-in.
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") return;
      load();
      void useDeviceCalendar.getState().reconcile();
    });
    return () => sub.remove();
  }, [load]);

  const fail = (title: string) => toast({ title, variant: "destructive", icon: CalendarDays });

  async function connect() {
    setBusy(true);
    try {
      // One target at a time: the phone calendar switches off first.
      if (useDeviceCalendar.getState().state.enabled) await useDeviceCalendar.getState().disable();
      await Linking.openURL((await startGoogleCalendar()).url);
    } catch {
      fail(t("Couldn't connect Google Calendar"));
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    try {
      setStatus(await syncGoogleCalendar());
    } catch {
      fail(t("Couldn't start the sync"));
    } finally {
      setBusy(false);
    }
  }

  function disconnect() {
    confirm(t("Disconnect Google Calendar?"), {
      confirmLabel: t("Disconnect"),
      onConfirm: () => {
        disconnectGoogleCalendar().then(
          async (next) => {
            setStatus(next);
            await useDeviceCalendar.getState().reconcile();
          },
          () => fail(t("Couldn't disconnect Google Calendar")),
        );
      },
    });
  }

  if (status && !status.available) return null;

  const needsReconnect = status?.state === "NEEDS_RECONNECT";
  const linked = !!status?.connected && !needsReconnect;

  return (
    <>
      <SettingsSectionLabel>{t("Google Calendar")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {status === undefined ? (
          <View className="px-4 py-3.5">
            <Skeleton className="h-5 w-40" />
          </View>
        ) : (
          <Pressable
            testID="google-calendar.connect"
            onPress={() => (linked ? disconnect() : void connect())}
            disabled={busy}
            className="flex-row items-center gap-[13px] px-4 py-3.5 active:opacity-70"
          >
            <View className="h-[38px] w-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
              <CalendarDays size={18} className="text-foreground" />
            </View>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text className="text-[16px] font-semibold">
                {linked ? t("Synced to Google Calendar") : needsReconnect ? t("Connection lost") : t("Sync to Google Calendar")}
              </Text>
              {linked ? (
                <Text className="text-[13px] text-muted-foreground">{lastSyncLabel(status as GoogleCalendarStatus, timeZone)}</Text>
              ) : null}
            </View>
            <Text className="text-[14px] font-semibold text-primary">
              {linked ? t("Disconnect") : needsReconnect ? t("Connect again") : t("Connect")}
            </Text>
          </Pressable>
        )}
        {linked ? (
          <Pressable
            testID="google-calendar.sync"
            onPress={() => void sync()}
            disabled={busy}
            className="flex-row items-center gap-2 border-t border-border px-4 py-3 active:opacity-70"
          >
            <RefreshCw size={16} className="text-primary" />
            <Text className="text-[14px] font-semibold text-primary">{t("Sync now")}</Text>
          </Pressable>
        ) : null}
      </View>
    </>
  );
}
