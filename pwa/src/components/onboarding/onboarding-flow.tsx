import { getGoogleCalendar } from "@/api/google-calendar";
import { listIntegrations } from "@/api/integrations";
import { listConnectedApps } from "@/api/oauth";
import { updateBasicInfo } from "@/api/users";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { Button } from "@/components/ui/button";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { Glass } from "@/components/ui/glass";
import { useUserStore } from "@/hooks/use-user-store";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { IntegrationStatus } from "@zenflow/shared";
import {
  CalendarDays,
  Check,
  ChevronDown,
  GraduationCap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AssistantsStep } from "./assistants-step";
import { CalendarStep } from "./calendar-step";
import { CampusConnectStep } from "./campus-connect-step";
import { saveRow, savedRow, type OnboardingRow } from "./onboarding-steps";

/** One connect row: tap to open its setup in place. */
function Row({
  icon: Icon,
  title,
  done,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  title: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <Glass
      frosted
      className="rounded-2xl border p-1 shadow-lg shadow-primary/5"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left"
      >
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-xl",
            done
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          {done ? <Check className="size-5" /> : <Icon className="size-5" />}
        </span>
        <span className="flex-1 text-[17px] font-semibold">{title}</span>
        <ChevronDown
          className={cn(
            "size-5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>
      {open && <div className="animate-rise-in px-3 pb-3 pt-1">{children}</div>}
    </Glass>
  );
}

/**
 * First-run setup on one screen: campus, calendar and assistant rows that open
 * in place. Every row is optional; the button leaves the screen either way.
 */
export function OnboardingFlow() {
  useLanguage();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);

  const [open, setOpen] = useState<OnboardingRow | null>(savedRow);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [googleLinked, setGoogleLinked] = useState(false);
  const [assistantLinked, setAssistantLinked] = useState(false);

  useEffect(() => saveRow(open), [open]);

  // Re-read when a row closes: that is when something may have just connected.
  useEffect(() => {
    listIntegrations()
      .then(setIntegrations)
      .catch(() => {});
    getGoogleCalendar()
      .then((g) =>
        setGoogleLinked(g.connected && g.state !== "NEEDS_RECONNECT"),
      )
      .catch(() => {});
    listConnectedApps()
      .then((r) => setAssistantLinked(r.apps.length > 0))
      .catch(() => {});
  }, [open]);

  const campusConnected = integrations.some((i) => i.connected);
  const notificationsOn = user?.allowNotifications === true;

  function saveFailed() {
    errorToast(t("Couldn't save"), {
      description: t("Try again in a moment."),
    });
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

  const toggle = (row: OnboardingRow) => () =>
    setOpen((cur) => (cur === row ? null : row));

  return (
    <div className="relative min-h-svh overflow-hidden bg-background">
      <SunriseBackdrop />
      <div className="relative mx-auto flex min-h-svh w-full max-w-xl flex-col px-6 py-8">
        <h1 className="mt-6 animate-rise-in text-[28px] leading-tight font-bold tracking-tight">
          {t("Connect your apps")}
        </h1>

        <div className="mt-6 flex flex-col gap-3">
          <Row
            icon={GraduationCap}
            title={t("Campus")}
            done={campusConnected}
            open={open === "campus"}
            onToggle={toggle("campus")}
          >
            <CampusConnectStep
              statuses={integrations}
              onConnected={(status) => {
                setIntegrations((prev) => [
                  ...prev.filter((s) => s.provider !== status.provider),
                  status,
                ]);
                setOpen(null);
              }}
            />
          </Row>
          <Row
            icon={CalendarDays}
            title={t("Calendar")}
            done={googleLinked || notificationsOn}
            open={open === "calendar"}
            onToggle={toggle("calendar")}
          >
            <CalendarStep
              notificationsOn={notificationsOn}
              blocked={blocked}
              busy={busy}
              onEnableNotifications={() => void enableNotifications()}
              onBeforeRedirect={() => saveRow("calendar")}
            />
          </Row>
          <Row
            icon={Sparkles}
            title={t("Assistant")}
            done={assistantLinked}
            open={open === "assistants"}
            onToggle={toggle("assistants")}
          >
            <AssistantsStep />
          </Row>
        </div>

        <div className="mt-auto pt-8">
          <Button
            type="button"
            size="lg"
            variant={campusConnected ? "default" : "outline"}
            className="h-12 w-full rounded-full text-base"
            disabled={busy}
            onClick={() => void finish()}
          >
            <BusyOr busy={busy} className="size-4">
              {campusConnected ? t("Open my calendar") : t("Skip for now")}
            </BusyOr>
          </Button>
        </div>
      </div>
    </div>
  );
}
