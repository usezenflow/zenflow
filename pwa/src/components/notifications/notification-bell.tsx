import { Button } from "@/components/ui/button";
import { t, useLanguage } from "@/lib/i18n";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useIsPhone } from "@/hooks/use-is-phone";
import { NotificationInbox } from "./notification-inbox";
import { useNotificationsStore } from "./notifications-store";
import { useNotificationsStream } from "./notifications-stream";

/**
 * The inbox entry point: a header bell with an unread count that opens the
 * notification inbox sheet. Mount it once per signed-in page; it owns the live stream.
 */
export function NotificationBell() {
  useLanguage();
  const [open, setOpen] = useState(false);
  const phone = useIsPhone();
  const unread = useNotificationsStore((s) => s.unreadCount);
  const refresh = useNotificationsStore((s) => s.refresh);
  useNotificationsStream();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <NotificationInbox
      open={open}
      onOpenChange={setOpen}
      trigger={
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="glass relative rounded-full"
        aria-label={t("Notifications")}
        onClick={phone ? () => setOpen(true) : undefined}
      >
        <Bell className="size-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[11px] leading-4 font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>
      }
    />
  );
}
