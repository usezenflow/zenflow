import { useCallback, useEffect, useState } from "react";
import { CalendarDays, RefreshCw } from "lucide-react";
import type { GoogleCalendarStatus } from "@zenflow/shared";
import {
  disconnectGoogleCalendar,
  getGoogleCalendar,
  startGoogleCalendar,
  syncGoogleCalendar,
} from "@/api/google-calendar";
import { IconTile, SettingsCard, SettingsLabel } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t, useLanguage } from "@/lib/i18n";
import { toast } from "@/lib/notify";
import { apiErrorMessage, errorToast } from "@/lib/toast";

const RESULT_PARAM = "google";

/** Reads and clears the `?google=` result the API redirects back with. */
function takeRedirectResult(): string | null {
  const url = new URL(window.location.href);
  const result = url.searchParams.get(RESULT_PARAM);
  if (result) {
    url.searchParams.delete(RESULT_PARAM);
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
  return result;
}

function lastSyncLabel(status: GoogleCalendarStatus, tz: string): string {
  if (!status.lastSyncedAt) return t("Not synced yet");
  const when = new Intl.DateTimeFormat(locale(), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz,
  }).format(new Date(status.lastSyncedAt));
  return t("Last synced {when}", { when });
}

/** Connect Google Calendar: the schedule shows there and on any phone signed in to Google. */
export function GoogleCalendarSection() {
  useLanguage();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await getGoogleCalendar());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    const result = takeRedirectResult();
    if (result === "connected") toast.success(t("Google Calendar connected"));
    else if (result) errorToast(t("Couldn't connect Google Calendar"));
    void load();
  }, [load]);

  async function run(work: () => Promise<GoogleCalendarStatus | void>, failure: string) {
    setBusy(true);
    try {
      const next = await work();
      if (next) setStatus(next);
    } catch (error) {
      errorToast(apiErrorMessage(error, failure));
    } finally {
      setBusy(false);
    }
  }

  const connect = () =>
    run(async () => {
      window.location.assign((await startGoogleCalendar()).url);
    }, t("Couldn't connect Google Calendar"));

  if (status && !status.available) return null;

  const needsReconnect = status?.state === "NEEDS_RECONNECT";

  return (
    <>
      <SettingsLabel>{t("Google Calendar")}</SettingsLabel>
      <SettingsCard>
        <div className="flex items-center gap-[13px] px-4 py-3.5">
          <IconTile icon={CalendarDays} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">
              {status?.connected && !needsReconnect
                ? t("Your schedule is in Google Calendar.")
                : t("See your schedule in Google Calendar and on your phone.")}
            </p>
            {status?.connected && !needsReconnect && (
              <p className="mt-0.5 text-[13px] text-muted-foreground">{lastSyncLabel(status, tz)}</p>
            )}
            {needsReconnect && (
              <p className="mt-0.5 text-[13px] text-destructive">{t("The link stopped working. Connect again.")}</p>
            )}
          </div>
        </div>

        {status ? (
          <div className="flex flex-wrap gap-2 px-4 pb-4">
            {!status.connected || needsReconnect ? (
              <Button size="sm" onClick={() => void connect()} disabled={busy} className="rounded-full">
                {needsReconnect ? t("Connect again") : t("Connect")}
              </Button>
            ) : confirming ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
                  {t("Cancel")}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const next = await disconnectGoogleCalendar();
                      setConfirming(false);
                      return next;
                    }, t("Couldn't disconnect Google Calendar"))
                  }
                >
                  {t("Disconnect")}
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void run(syncGoogleCalendar, t("Couldn't start the sync"))}
                  className="rounded-full"
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t("Sync now")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirming(true)} className="rounded-full">
                  {t("Disconnect")}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="px-4 pb-4">
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        )}
      </SettingsCard>
    </>
  );
}
