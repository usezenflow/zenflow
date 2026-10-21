import { Button } from "@/components/ui/button";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { dateFnsLocale, t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { NotificationDto } from "@zenflow/shared";
import { formatDistanceToNow } from "date-fns";
import { Check, ChevronRight, RefreshCw, X } from "lucide-react";
import { eventTimeLabel, isConflict, notificationVisual } from "./utils";

/** One inbox row: type icon, title, when it was raised and when it is due. */
export function NotificationRow({
  n,
  tz,
  selecting,
  selected,
  rescheduling,
  onOpen,
  onDismiss,
  onReschedule,
}: {
  n: NotificationDto;
  tz: string;
  selecting: boolean;
  selected: boolean;
  rescheduling: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  onReschedule: () => void;
}) {
  useLanguage();
  const { Icon, tint } = notificationVisual(n.eventName, n.sessionType);
  const unread = !n.readAt;
  const navigable = Boolean(n.sessionId);
  const relative = formatDistanceToNow(new Date(n.sentAt), {
    addSuffix: true,
    locale: dateFnsLocale(),
  });
  const when = eventTimeLabel(n, tz);
  // Rescheduling stamps `actionTakenAt` but keeps `conflictSessionIds`.
  const canReschedule =
    !selecting &&
    isConflict(n.eventName) &&
    !n.actionTakenAt &&
    n.conflictSessionIds.length > 0;

  return (
    <div
      className={cn(
        "border-b border-border/70 px-4 py-3",
        unread && "bg-primary/[0.04]",
        selected && "bg-primary/[0.09]",
      )}
    >
      <div className="flex items-center gap-3">
        {selecting && (
          <span
            role="checkbox"
            aria-checked={selected}
            aria-label={t("Select")}
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px]",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-muted-foreground/50",
            )}
          >
            {selected && <Check className="size-3.5" strokeWidth={3} />}
          </span>
        )}
        <button
          type="button"
          onClick={onOpen}
          title={n.content}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
        >
          <span className="relative shrink-0">
            <span
              className={cn(
                "flex size-11 items-center justify-center rounded-2xl border",
                tint,
              )}
            >
              <Icon className="size-5" strokeWidth={2.3} />
            </span>
            {unread && (
              <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-destructive" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "block truncate text-[14px]",
                unread ? "font-semibold text-foreground" : "font-medium text-foreground/85",
              )}
            >
              {n.title}
            </span>
            <span
              className={cn(
                "mt-0.5 flex items-center gap-2 text-[12px]",
                unread ? "font-medium text-foreground/80" : "text-muted-foreground",
              )}
            >
              <span className="shrink-0">{relative}</span>
              {when && <span className="truncate">{when}</span>}
            </span>
          </span>
          {!selecting && navigable && (
            <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" />
          )}
        </button>
        {!selecting && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("Dismiss")}
            onClick={onDismiss}
            className="shrink-0 text-muted-foreground"
          >
            <X />
          </Button>
        )}
      </div>
      {canReschedule && (
        <div className="mt-2 pl-14">
          <Button
            type="button"
            size="sm"
            className="rounded-full"
            disabled={rescheduling}
            onClick={onReschedule}
          >
            <BusyOr busy={rescheduling} className="size-3.5">
              <RefreshCw />
            </BusyOr>
            {t("Reschedule")}
          </Button>
        </div>
      )}
    </div>
  );
}
