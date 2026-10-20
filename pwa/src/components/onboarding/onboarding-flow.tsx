import { listIntegrations } from "@/api/integrations";
import { updateBasicInfo } from "@/api/users";
import { TravelSection } from "@/components/settings/travel-section";
import { useMyLocationStop } from "@/lib/places/use-my-location-stop";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { Button } from "@/components/ui/button";
import { Glass } from "@/components/ui/glass";
import { languageOption } from "@/lib/languages";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { useUserStore } from "@/hooks/use-user-store";
import { getLanguage, t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { FocusBand, IntegrationStatus } from "@zenflow/shared";
import {
  AlertCircle,
  Bell,
  Check,
  ChevronLeft,
  GraduationCap,
  LocateFixed,
  MoonStar,
  Sun,
  Sunrise,
  Sunset,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CampusConnectStep } from "./campus-connect-step";
import {
  canGoBack,
  DEFAULT_FOCUS_BAND,
  FIRST_STEP,
  focusBandOptions,
  nextStep,
  type OnboardingStep,
  prevStep,
  stepProgress,
} from "./onboarding-steps";

/** Glyph and tint per focus band, warm at dawn and cool at night. */
const BAND_VISUAL: Record<
  FocusBand,
  { Icon: LucideIcon; tint: string; ink: string }
> = {
  MORNING: {
    Icon: Sunrise,
    tint: "border-session-conflict/40 bg-session-conflict/15",
    ink: "text-session-conflict-ink",
  },
  AFTERNOON: {
    Icon: Sun,
    tint: "border-primary/40 bg-primary/15",
    ink: "text-primary",
  },
  EVENING: {
    Icon: Sunset,
    tint: "border-destructive/40 bg-destructive/15",
    ink: "text-destructive",
  },
  LATE_NIGHT: {
    Icon: MoonStar,
    tint: "border-indigo-500/40 bg-indigo-500/15",
    ink: "text-indigo-600 dark:text-indigo-400",
  },
};

const STEP_ICON: Partial<Record<OnboardingStep, LucideIcon>> = {
  focus: Sun,
  campus: GraduationCap,
  commute: LocateFixed,
  notifications: Bell,
};

function languageLabel(): string {
  const l = languageOption(getLanguage());
  return `${l.flag} ${l.label}`;
}

/** Card whose rows are separated by hairlines. */
function Group({ children }: { children: ReactNode }) {
  return (
    <div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card/60">
      {children}
    </div>
  );
}

/**
 * First-run setup: focus, campus connect, commute, notifications, then a summary.
 * Each step can be skipped; skipped items are listed on the summary with a
 * "Set up" link that returns to them.
 */
export function OnboardingFlow() {
  useLanguage();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);

  const [step, setStep] = useState<OnboardingStep>(FIRST_STEP);
  // Set when a skipped step is reopened from the summary: finishing, skipping
  // or going back returns to the summary.
  const [fromSummary, setFromSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [focusBand, setFocusBand] = useState<FocusBand>(
    user?.focusBand ?? DEFAULT_FOCUS_BAND,
  );
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const myLocation = useMyLocationStop();

  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {});
  }, []);

  const campusConnected = integrations.some((i) => i.connected);
  const notificationsOn = user?.allowNotifications === true;
  const home = user?.homeLocation ?? null;

  /** Asks the browser for location, then saves the position as home. */
  async function saveHomeFromLocation() {
    const point = await myLocation.locate();
    if (!point) return;
    setBusy(true);
    try {
      setUser(
        await updateBasicInfo({
          homeLocation: t("My location"),
          homeLat: point.lat,
          homeLng: point.lng,
        }),
      );
    } catch {
      saveFailed();
    } finally {
      setBusy(false);
    }
  }

  function go() {
    if (fromSummary) {
      setFromSummary(false);
      setStep("done");
    } else {
      setStep((s) => nextStep(s));
    }
  }

  function goBack() {
    setBlocked(false);
    if (fromSummary) {
      setFromSummary(false);
      setStep("done");
    } else {
      setStep((s) => prevStep(s));
    }
  }

  function skip() {
    setBlocked(false);
    go();
  }

  function saveFailed() {
    errorToast(t("Couldn't save"), { description: t("Try again in a moment.") });
  }

  /** Runs a save; advances unless it returns `false`. A throw keeps the step. */
  async function run(fn: () => Promise<boolean | void>) {
    setBusy(true);
    try {
      if ((await fn()) !== false) go();
    } catch {
      saveFailed();
    } finally {
      setBusy(false);
    }
  }

  const saveFocus = () =>
    run(async () => {
      if (focusBand === user?.focusBand) return;
      setUser(await updateBasicInfo({ focusBand }));
    });

  async function setNotifications(allow: boolean) {
    setBusy(true);
    try {
      setUser(await updateBasicInfo({ allowNotifications: allow }));
    } catch {
      saveFailed();
    } finally {
      setBusy(false);
    }
  }

  /** Asks the browser for permission, then records the preference. */
  async function enableNotifications() {
    setBusy(true);
    try {
      if (typeof Notification !== "undefined") {
        const permission =
          Notification.permission === "default"
            ? await Notification.requestPermission()
            : Notification.permission;
        if (permission !== "granted") {
          setBlocked(true);
          return;
        }
      }
      setUser(await updateBasicInfo({ allowNotifications: true }));
      go();
    } catch {
      saveFailed();
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      setUser(await updateBasicInfo({ onboarded: true }));
      navigate("/", { replace: true });
    } catch {
      saveFailed();
    } finally {
      setBusy(false);
    }
  }

  const progress = stepProgress(step);

  const primary = (label: string, onClick: () => void, disabled = false) => (
    <Button
      type="button"
      size="lg"
      className="h-12 w-full rounded-full text-base"
      disabled={busy || disabled}
      onClick={onClick}
    >
      <BusyOr busy={busy} className="size-4">
        {label}
      </BusyOr>
    </Button>
  );

  const ghost = (label: string, onClick: () => void) => (
    <Button
      type="button"
      variant="ghost"
      className="w-full text-muted-foreground"
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </Button>
  );

  let title = "";
  let body = "";
  let content: ReactNode = null;
  let footer: ReactNode = null;

  switch (step) {
    case "focus": {
      title = t("When do you focus best?");
      body = t("We'll try this part of the day first when we place your sessions.");
      content = (
        <Group>
          {focusBandOptions().map((option) => {
            const on = focusBand === option.band;
            const { Icon, tint, ink } = BAND_VISUAL[option.band];
            return (
              <button
                key={option.band}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={busy}
                onClick={() => setFocusBand(option.band)}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-3 text-left",
                  on && "bg-primary/[0.06]",
                )}
              >
                <span
                  className={cn(
                    "flex size-10 shrink-0 items-center justify-center rounded-xl border",
                    tint,
                  )}
                >
                  <Icon className={cn("size-5", ink)} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block text-[15px]",
                      on ? "font-semibold" : "font-medium",
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-muted-foreground">
                    {option.hours}
                  </span>
                </span>
                {on && <Check className="size-[18px] text-primary" />}
              </button>
            );
          })}
        </Group>
      );
      footer = (
        <>
          {primary(t("Continue"), () => void saveFocus())}
          {ghost(t("Skip for now"), skip)}
        </>
      );
      break;
    }
    case "campus": {
      title = t("Connect your LMS or portal");
      body = t(
        "Zenflow keeps an eye on your timetable, exams and assignments, so they land on your calendar. Your login is only used to check your LMS and portal for you.",
      );
      content = (
        <div className="flex flex-col gap-4">
          <CampusConnectStep
            statuses={integrations}
            onConnected={(status) =>
              setIntegrations((prev) => [
                ...prev.filter((s) => s.provider !== status.provider),
                status,
              ])
            }
          />
          <p className="px-1 text-[12px] leading-snug text-muted-foreground">
            {t("Your password is stored encrypted. Disconnect in Settings to delete it.")}
          </p>
          <p className="px-1 text-[12px] leading-snug text-muted-foreground">
            {t("You can also do this later in Settings, under Connect your LMS or portal.")}
          </p>
        </div>
      );
      footer = (
        <>
          {primary(t("Continue"), go)}
          {!campusConnected && ghost(t("Skip for now"), skip)}
        </>
      );
      break;
    }
    case "commute": {
      title = t("Plan your commute");
      body = t(
        "Share where you leave from and how you travel. We'll add buffer time before sessions on campus.",
      );
      content = (
        <div className="flex flex-col gap-4">
          <Group>
            <button
              type="button"
              data-testid="onboarding.commute.use-location"
              disabled={busy || myLocation.locating}
              onClick={() => void saveHomeFromLocation()}
              className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
            >
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <BusyOr busy={myLocation.locating} className="size-4">
                  <LocateFixed className="size-[18px]" />
                </BusyOr>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">
                  {t("Use my location")}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {t("Set your home to where you are now")}
                </span>
              </span>
            </button>
          </Group>
          {myLocation.note && (
            <div className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
              <AlertCircle className="size-5 shrink-0 text-destructive" />
              <p className="text-[13.5px] leading-snug">{myLocation.note}</p>
            </div>
          )}
          {user && <TravelSection user={user} hideLabel />}
        </div>
      );
      footer = (
        <>
          {primary(t("Continue"), go)}
          {!home && ghost(t("Skip for now"), skip)}
        </>
      );
      break;
    }
    case "notifications": {
      title = t("Stay ahead of deadlines");
      body = t(
        "Get a nudge when a session is near or your schedule changes. We'll ask for permission next.",
      );
      content = (
        <div className="flex flex-col gap-5">
          <Group>
            <div className="flex items-center gap-3.5 px-4 py-3.5">
              <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
                <Bell className="size-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">
                  {t("Allow notifications")}
                </span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">
                  {t("Reminders and schedule changes")}
                </span>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={notificationsOn}
                aria-label={t("Allow notifications")}
                disabled={busy}
                onClick={() =>
                  notificationsOn
                    ? void setNotifications(false)
                    : void enableNotifications()
                }
                className={cn(
                  "flex h-[26px] w-[46px] shrink-0 items-center rounded-full px-[3px] transition",
                  notificationsOn ? "justify-end bg-primary" : "justify-start bg-muted",
                )}
              >
                <span className="size-5 rounded-full bg-card shadow" />
              </button>
            </div>
          </Group>
          <ul className="flex flex-col gap-3 px-1">
            {[
              t("Reminder before each study session"),
              t("Alert when the timetable or an exam changes"),
              t("New LMS assignments, scheduled for you"),
            ].map((line) => (
              <li key={line} className="flex items-start gap-2.5 text-[13.5px] text-muted-foreground">
                <Check className="mt-0.5 size-4 shrink-0 text-primary" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          {blocked && (
            <div className="flex gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
              <AlertCircle className="size-5 shrink-0 text-destructive" />
              <div>
                <p className="text-[13.5px] font-semibold">
                  {t("Notifications are blocked")}
                </p>
                <p className="mt-1 text-[13.5px] leading-snug text-muted-foreground">
                  {t("Turn them on in your browser settings to get reminders. For now, they stay off.")}
                </p>
              </div>
            </div>
          )}
        </div>
      );
      footer = (
        <>
          {notificationsOn || blocked
            ? primary(t("Continue"), go)
            : primary(t("Turn on notifications"), () => void enableNotifications())}
          {!notificationsOn &&
            ghost(t("Not now"), () =>
              run(async () => {
                setUser(await updateBasicInfo({ allowNotifications: false }));
              }),
            )}
        </>
      );
      break;
    }
    case "done": {
      title = t("You’re all set");
      body = t("Skipped steps are waiting for you in Settings.");
      const rows: {
        key: string;
        value: string;
        skipped: boolean;
        step?: OnboardingStep;
      }[] = [
        { key: t("Language"), value: languageLabel(), skipped: false },
        { key: t("Name"), value: user?.name ?? "", skipped: false },
        {
          key: t("LMS & portal"),
          value: campusConnected ? t("Connected") : t("Skipped"),
          skipped: !campusConnected,
          step: "campus",
        },
        {
          key: t("Home"),
          value: home ?? t("Skipped"),
          skipped: !home,
          step: "commute",
        },
        {
          key: t("Notifications"),
          value: notificationsOn ? t("On") : t("Skipped"),
          skipped: !notificationsOn,
          step: "notifications",
        },
      ];
      content = (
        <Group>
          {rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between px-4 py-3">
              <span className="text-[14.5px] font-medium">{r.key}</span>
              <span className="flex items-center gap-2.5">
                <span className="text-[13px] text-muted-foreground">{r.value}</span>
                {r.skipped && r.step ? (
                  <button
                    type="button"
                    className="text-[13px] font-semibold text-primary hover:underline"
                    onClick={() => {
                      setFromSummary(true);
                      setStep(r.step as OnboardingStep);
                    }}
                  >
                    {t("Set up")}
                  </button>
                ) : (
                  <Check className="size-4 text-primary" />
                )}
              </span>
            </div>
          ))}
        </Group>
      );
      footer = primary(t("Open my calendar"), () => void finish());
      break;
    }
  }

  const Hero = STEP_ICON[step];
  const isDone = step === "done";

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <SunriseBackdrop />
      <div className="relative mx-auto flex min-h-svh w-full max-w-xl flex-col px-6 py-8">
        {!isDone && (
          <div className="flex items-center gap-3">
            {canGoBack(step) ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t("Back")}
                disabled={busy}
                onClick={goBack}
              >
                <ChevronLeft />
              </Button>
            ) : (
              <span className="size-9" />
            )}
            <div className="flex flex-1 gap-1.5">
              {Array.from({ length: progress.total }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    "h-1 flex-1 rounded-full",
                    i < progress.index ? "bg-primary" : "bg-muted",
                  )}
                />
              ))}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="font-semibold text-muted-foreground"
              disabled={busy}
              onClick={skip}
            >
              {t("Skip")}
            </Button>
          </div>
        )}

        <Glass
          frosted
          className="mt-8 flex flex-col rounded-3xl border p-[18px] shadow-xl shadow-primary/10"
        >
        <div className={cn("flex flex-col", isDone && "items-center text-center")}>
          {isDone ? (
            <span className="mb-5 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-8" />
            </span>
          ) : (
            Hero && (
              <span className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Hero className="size-6" />
              </span>
            )
          )}
          <h1 className="text-[26px] leading-tight font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{body}</p>
        </div>

        <div className="mt-6">{content}</div>
        </Glass>

        <div className="mt-auto flex flex-col gap-1 pt-6">{footer}</div>
      </div>
    </div>
  );
}

