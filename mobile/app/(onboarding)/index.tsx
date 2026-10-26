import { t } from "@/lib/i18n";
import { useLanguage } from "@/hooks/use-language";
import { listIntegrations } from "@/api/integrations";
import { updateBasicInfo } from "@/api/users";
import { Sliders } from "@/components/Icons";
import { StepMark } from "@/components/brand/onboarding-marks";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { FlipWords } from "@/components/fx/flip-words";
import { LampProgress } from "@/components/fx/lamp-progress";
import { MovingBorder } from "@/components/fx/moving-border";
import { Burst, Sparkles } from "@/components/fx/sparkles";
import { Spotlight } from "@/components/fx/spotlight";
import { TiltCard } from "@/components/fx/tilt-card";
import { TextGenerate } from "@/components/fx/text-generate";
import { Logo } from "@/components/logo";
import { Glass } from "@/components/ui/glass";
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
import { useReducedMotion } from "@/lib/motion";
import { useColorScheme } from "@/lib/useColorScheme";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const STEPS = ["welcome", "campus", "calendar", "assistants", "done"] as const;
type Step = (typeof STEPS)[number];

const COPY: Record<
  Exclude<Step, "welcome">,
  { title: string; body: string }
> = {
  campus: { title: "Bring your classes", body: "Import your timetable" },
  calendar: { title: "Stay in the loop", body: "Sync and get reminders" },
  assistants: { title: "Plan by chatting", body: "Link your AI assistant" },
  done: { title: "You're all set", body: "Your week is ready" },
};

/**
 * First-run setup as a short tap-first story: welcome, campus, calendar,
 * assistant, done. Every step is optional; Skip moves on, the last button
 * leaves the screen either way.
 */
export default function OnboardingScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const { toast } = useToast();
  const updateUser = useUserStore((s) => s.updateUser);
  const { setIntegrations, setLoading, integrations } = useIntegrationStore();
  const notif = useNotificationToggle();

  const [stepIndex, setStepIndex] = useState(0);
  const step = STEPS[stepIndex];
  const reduce = useReducedMotion();
  const { isDarkColorScheme } = useColorScheme();
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [setIntegrations, setLoading]);

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

  function next() {
    void Haptics.selectionAsync();
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  }

  useEffect(() => {
    if (step === "done")
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [step]);

  const last = step === "done";
  const showCard =
    step === "campus" || step === "calendar" || step === "assistants";
  const copy = step === "welcome" ? null : COPY[step];

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-background"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <SunriseBackdrop
        dark={isDarkColorScheme}
        energy={step === "welcome" || last ? "lively" : "calm"}
      />
      {step === "welcome" || last ? <Sparkles /> : null}
      {last ? <Burst /> : null}
      <View className="px-8" style={{ paddingTop: insets.top + 16 }}>
        <LampProgress step={stepIndex} total={STEPS.length} />
      </View>
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          paddingHorizontal: 20,
          paddingVertical: 16,
        }}
      >
        <Animated.View
          key={step}
          entering={reduce ? undefined : FadeInDown.duration(320)}
          className="items-center gap-5"
        >
          {step === "welcome" ? (
            <>
              <View
                className="items-center justify-center"
                style={{ height: 200, width: 280 }}
              >
                <Spotlight />
                <Logo glow breathe className="h-[96px] w-[96px]" />
              </View>
              <TextGenerate
                text={t("Your days, on autopilot")}
                className="text-[32px] font-bold leading-tight tracking-tight"
              />
              <FlipWords
                words={[t("Classes"), t("Deadlines"), t("Focus time")]}
                className="text-[20px] font-semibold text-primary"
              />
            </>
          ) : copy ? (
            <>
              {step === "done" ? <StepMark kind="done" /> : null}
              <View className="items-center gap-1">
                <Text className="text-[28px] font-bold leading-tight tracking-tight">
                  {t(copy.title)}
                </Text>
                <Text className="text-[15px] text-muted-foreground">
                  {t(copy.body)}
                </Text>
              </View>
            </>
          ) : null}
          {showCard ? (
            <TiltCard>
              <View
                className="w-full"
                style={{
                  borderRadius: 24,
                  shadowColor: isDarkColorScheme ? "#000" : "#B4540A",
                  shadowOpacity: isDarkColorScheme ? 0.4 : 0.14,
                  shadowRadius: 22,
                  shadowOffset: { width: 0, height: 10 },
                  elevation: 6,
                }}
              >
                <Glass
                  frosted
                  radius={24}
                  intensity={60}
                  style={{ padding: 12, borderWidth: 1 }}
                >
                  {step === "campus" ? (
                    <CampusStep
                      statuses={integrations}
                      onConnected={(status) => {
                        setIntegrations([
                          ...integrations.filter(
                            (i) => i.provider !== status.provider,
                          ),
                          status,
                        ]);
                      }}
                    />
                  ) : step === "calendar" ? (
                    <CalendarStep
                      notificationsOn={notif.active}
                      blocked={blocked}
                      busy={busy}
                      onEnableNotifications={() => void enableNotifications()}
                    />
                  ) : (
                    <AssistantsStep />
                  )}
                </Glass>
              </View>
            </TiltCard>
          ) : null}
        </Animated.View>
      </ScrollView>
      <View
        className="gap-1 px-5 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <MovingBorder>
          <Button
            size="lg"
            className="rounded-full"
            testID="onboarding.primary"
            disabled={busy}
            onPress={last ? () => void finish() : next}
          >
            <BusyOr busy={busy} testID="onboarding.busy" tone="onPrimary">
              <Text className="font-semibold text-primary-foreground">
                {last
                  ? t("Open my calendar")
                  : step === "welcome"
                    ? t("Let's go")
                    : t("Next")}
              </Text>
            </BusyOr>
          </Button>
        </MovingBorder>
        {showCard ? (
          <Button
            variant="ghost"
            size="lg"
            className="rounded-full"
            testID="onboarding.secondary"
            onPress={next}
          >
            <Text className="font-medium text-muted-foreground">
              {t("Skip")}
            </Text>
          </Button>
        ) : null}
      </View>
    </KeyboardAvoidingView>
  );
}
