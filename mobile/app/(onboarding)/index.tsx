import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { getGoogleCalendar } from "@/api/google-calendar";
import { listIntegrations } from "@/api/integrations";
import { listConnectedApps } from "@/api/oauth";
import { updateBasicInfo } from "@/api/users";
import {
  CalendarDays,
  Check,
  ChevronDown,
  GraduationCap,
  Sliders,
  Sparkles,
} from "@/components/Icons";
import { AssistantsStep } from "@/components/onboarding/assistants-step";
import { CalendarStep } from "@/components/onboarding/calendar-step";
import { CampusStep } from "@/components/onboarding/campus-step";
import { Button } from "@/components/ui/button";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useNotificationToggle } from "@/hooks/use-notification-toggle";
import { usePushStatusStore } from "@/hooks/use-push-status-store";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type Row = "campus" | "calendar" | "assistants";

/** One connect row: tap to open its setup in place. */
function ConnectRow({
  icon: Icon,
  title,
  done,
  open,
  onToggle,
  testID,
  children,
}: {
  icon: typeof GraduationCap;
  title: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <View className="overflow-hidden rounded-2xl border border-border bg-card">
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        className="flex-row items-center gap-3 px-3 py-3"
      >
        <View
          className={cn(
            "size-10 items-center justify-center rounded-xl",
            done ? "bg-primary" : "bg-primary/10",
          )}
        >
          {done ? (
            <Check size={20} className="text-primary-foreground" />
          ) : (
            <Icon size={20} className="text-primary" />
          )}
        </View>
        <Text className="flex-1 text-[17px] font-semibold">{title}</Text>
        <ChevronDown
          size={20}
          className={cn("text-muted-foreground", open && "rotate-180")}
        />
      </Pressable>
      {open ? <View className="px-3 pb-3 pt-1">{children}</View> : null}
    </View>
  );
}

/**
 * First-run setup on one screen: campus, calendar and assistant rows that open
 * in place. Every row is optional; the button leaves the screen either way.
 */
export default function OnboardingScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const updateUser = useUserStore((s) => s.updateUser);
  const { setIntegrations, setLoading, integrations } = useIntegrationStore();
  const notif = useNotificationToggle();

  const [open, setOpen] = useState<Row | null>("campus");
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [assistantLinked, setAssistantLinked] = useState(false);

  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setIntegrations, setLoading]);

  // Re-read when a row closes: that is when something may have just connected.
  useEffect(() => {
    getGoogleCalendar()
      .then((g) =>
        setGoogleLinked(g.connected && g.state !== "NEEDS_RECONNECT"),
      )
      .catch(() => {});
    listConnectedApps()
      .then((r) => setAssistantLinked(r.apps.length > 0))
      .catch(() => {});
  }, [open]);

  // Returning from system settings with permission granted clears the hint.
  useEffect(() => {
    if (notif.permissionGranted) setBlocked(false);
  }, [notif.permissionGranted]);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void usePushStatusStore.getState().refresh();
    });
    return () => sub.remove();
  }, []);

  const campusConnected = integrations.some((i) => i.connected);
  const saveFailed = () =>
    toast({
      title: t("Couldn't save"),
      description: t("Try again in a moment."),
      variant: "destructive",
      icon: Sliders,
    });

  /**
   * Turn notifications on. "saved" = the preference is on but this device
   * couldn't register (simulator / no FCM): a quiet success, retried next
   * launch. A failed preference save is NOT that.
   */
  async function turnOnNotifications(): Promise<
    "on" | "saved" | "blocked" | "failed"
  > {
    if (await notif.setEnabled(true, { quiet: true })) return "on";
    const granted = usePushStatusStore.getState().permission === "granted";
    if (!granted) return "blocked";
    if (useUserStore.getState().user?.allowNotifications === true) {
      return "saved";
    }
    saveFailed();
    return "failed";
  }

  // A ref, not `busy`: taps queued behind a busy JS thread all see the same
  // stale `busy === false` closure and would each start a request.
  const notifPending = useRef(false);

  async function enableNotifications() {
    if (notifPending.current) return;
    notifPending.current = true;
    setBusy(true);
    try {
      const result = await turnOnNotifications();
      setBusy(false);
      setBlocked(result === "blocked");
    } finally {
      notifPending.current = false;
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      // Idempotent; the root AuthGate then routes to the app.
      updateUser(await updateBasicInfo({ onboarded: true }));
    } catch {
      saveFailed();
      setBusy(false);
    }
  }

  const toggle = (row: Row) => () =>
    setOpen((cur) => (cur === row ? null : row));

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View className="px-6 pt-3" style={{ paddingTop: insets.top + 24 }}>
          <Text className="text-[28px] font-bold leading-tight tracking-tight">
            {t("Connect your apps")}
          </Text>
        </View>
        <View className="mt-6 gap-3 px-5">
          <ConnectRow
            testID="onboarding.row.campus"
            icon={GraduationCap}
            title={t("Campus")}
            done={campusConnected}
            open={open === "campus"}
            onToggle={toggle("campus")}
          >
            <CampusStep
              statuses={integrations}
              onConnected={(status) => {
                setIntegrations([
                  ...integrations.filter((i) => i.provider !== status.provider),
                  status,
                ]);
                setOpen(null);
              }}
            />
          </ConnectRow>
          <ConnectRow
            testID="onboarding.row.calendar"
            icon={CalendarDays}
            title={t("Calendar")}
            done={googleLinked || notif.active}
            open={open === "calendar"}
            onToggle={toggle("calendar")}
          >
            <CalendarStep
              notificationsOn={notif.active}
              blocked={blocked}
              busy={busy}
              onEnableNotifications={() => void enableNotifications()}
            />
          </ConnectRow>
          <ConnectRow
            testID="onboarding.row.assistants"
            icon={Sparkles}
            title={t("Assistant")}
            done={assistantLinked}
            open={open === "assistants"}
            onToggle={toggle("assistants")}
          >
            <AssistantsStep />
          </ConnectRow>
        </View>
      </ScrollView>
      <View className="px-5 pt-3" style={{ paddingBottom: insets.bottom + 12 }}>
        <Button
          size="lg"
          className="rounded-full"
          variant={campusConnected ? "default" : "outline"}
          testID="onboarding.primary"
          disabled={busy}
          onPress={() => void finish()}
        >
          <BusyOr busy={busy} testID="onboarding.busy" tone="onPrimary">
            <Text
              className={cn(
                "font-semibold",
                campusConnected ? "text-primary-foreground" : "text-foreground",
              )}
            >
              {campusConnected ? t("Open my calendar") : t("Skip for now")}
            </Text>
          </BusyOr>
        </Button>
      </View>
    </KeyboardAvoidingView>
  );
}
