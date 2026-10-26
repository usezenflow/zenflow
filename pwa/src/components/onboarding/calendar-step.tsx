import { useEffect, useState } from "react";
import { Bell, CalendarDays } from "lucide-react";
import type { GoogleCalendarStatus } from "@zenflow/shared";
import { getGoogleCalendar, startGoogleCalendar } from "@/api/google-calendar";
import { t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { ConnectTile } from "./connect-tile";

/** Two taps: link Google Calendar, allow reminders. Both land back here. */
export function CalendarStep({
  notificationsOn,
  blocked,
  busy,
  onEnableNotifications,
  onBeforeRedirect,
}: {
  notificationsOn: boolean;
  blocked: boolean;
  busy: boolean;
  onEnableNotifications: () => void;
  onBeforeRedirect: () => void;
}) {
  useLanguage();
  const [status, setStatus] = useState<GoogleCalendarStatus | null | undefined>(
    undefined,
  );
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    getGoogleCalendar()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  async function connect() {
    setStarting(true);
    try {
      const { url } = await startGoogleCalendar();
      onBeforeRedirect();
      window.location.assign(url);
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Couldn't connect Google Calendar")));
      setStarting(false);
    }
  }

  const linked = !!status?.connected && status.state !== "NEEDS_RECONNECT";
  const unavailable =
    status === null || (status !== undefined && !status.available);

  return (
    <div className="flex flex-col gap-3">
      <ConnectTile
        icon={CalendarDays}
        title={t("Google Calendar")}
        hint={
          unavailable ? t("Not available") : linked ? t("Connected") : undefined
        }
        state={
          unavailable
            ? "off"
            : linked
              ? "done"
              : starting || status === undefined
                ? "busy"
                : "idle"
        }
        onClick={() => void connect()}
      />
      <ConnectTile
        icon={Bell}
        title={t("Reminders")}
        hint={blocked ? t("Blocked") : notificationsOn ? t("On") : undefined}
        state={notificationsOn ? "done" : busy ? "busy" : "idle"}
        onClick={onEnableNotifications}
      />
    </div>
  );
}
