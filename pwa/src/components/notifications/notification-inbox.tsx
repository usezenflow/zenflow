import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyMark } from "@/components/brand/state-marks";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsPhone } from "@/hooks/use-is-phone";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { NotificationDto } from "@zenflow/shared";
import { Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "@/lib/notify";
import { NotificationRow } from "./notification-row";
import {
  openNotificationSession,
  rescheduleNotification,
  useNotificationsStore,
} from "./notifications-store";

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5];

/**
 * The ingestion inbox: LMS, portal and reminder notifications. A bottom sheet
 * on phones, a dropdown under `trigger` (the bell) on tablet and desktop. Rows
 * open their session on the calendar; the trash and select controls delete rows.
 */
export function NotificationInbox({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The bell. On tablet and up it anchors the dropdown and toggles it. */
  trigger: ReactNode;
}) {
  useLanguage();
  const phone = useIsPhone();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const items = useNotificationsStore((s) => s.items);
  const unreadCount = useNotificationsStore((s) => s.unreadCount);
  const loaded = useNotificationsStore((s) => s.loaded);
  const refresh = useNotificationsStore((s) => s.refresh);
  const markRead = useNotificationsStore((s) => s.markRead);
  const remove = useNotificationsStore((s) => s.remove);

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmClear, setConfirmClear] = useState(false);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void refresh();
    } else {
      setSelecting(false);
      setSelected(new Set());
    }
  }, [open, refresh]);

  const allSelected = items.length > 0 && selected.size === items.length;

  function exitSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openRow(n: NotificationDto) {
    if (selecting) {
      toggle(n.id);
      return;
    }
    markRead(n.id);
    if (await openNotificationSession(n)) onOpenChange(false);
  }

  async function dismiss(n: NotificationDto) {
    try {
      await remove([n.id]);
    } catch {
      errorToast(t("Couldn't dismiss notification"), {
        description: t("Try again in a moment."),
      });
    }
  }

  async function deleteSelected() {
    const ids = [...selected];
    if (ids.length === 0) return;
    exitSelecting();
    try {
      await remove(ids);
      toast(t("Deleted {count} notifications", { count: ids.length }), { icon: "trash" });
    } catch {
      errorToast(t("Couldn't delete notifications"), {
        description: t("Try again in a moment."),
      });
    }
  }

  async function clearAll() {
    const ids = items.map((x) => x.id);
    setConfirmClear(false);
    exitSelecting();
    try {
      await remove(ids);
      toast(t("All notifications cleared"), { icon: "trash" });
    } catch {
      errorToast(t("Couldn't clear notifications"), {
        description: t("Try again in a moment."),
      });
    }
  }

  async function reschedule(n: NotificationDto) {
    setReschedulingId(n.id);
    await rescheduleNotification(n);
    setReschedulingId(null);
  }

  const Title = phone ? SheetTitle : "h2";
  const panel = (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-3">
        {selecting ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Cancel selection")}
              onClick={exitSelecting}
            >
              <X />
            </Button>
            <span className="flex-1 text-[15px] font-semibold">
              {t("{count} selected", { count: selected.size })}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="font-semibold text-primary"
              onClick={() =>
                setSelected(
                  allSelected ? new Set() : new Set(items.map((x) => x.id)),
                )
              }
            >
              {allSelected ? t("None") : t("All")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("Delete selected")}
              disabled={selected.size === 0}
              className="text-destructive"
              onClick={() =>
                allSelected ? setConfirmClear(true) : void deleteSelected()
              }
            >
              <Trash2 />
            </Button>
          </>
        ) : (
          <>
            <Title className="flex flex-1 items-center gap-2 text-xl font-bold tracking-tight">
              {t("Inbox")}
              {unreadCount > 0 && (
                <span className="rounded-full bg-primary px-2 text-[13px] leading-[22px] font-bold text-primary-foreground">
                  {unreadCount.toLocaleString(locale())}
                </span>
              )}
            </Title>
            {items.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="font-semibold text-primary"
                onClick={() => setSelecting(true)}
              >
                {t("Select")}
              </Button>
            )}
          </>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!loaded ? (
          <InboxSkeleton />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
            <div className="mb-4">
              <EmptyMark />
            </div>
            <p className="text-[16px] font-semibold">{t("You're all caught up")}</p>
            <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
              {t("Nothing new from your LMS or student portal.")}
            </p>
          </div>
        ) : (
          items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              tz={tz}
              selecting={selecting}
              selected={selected.has(n.id)}
              rescheduling={reschedulingId === n.id}
              onOpen={() => void openRow(n)}
              onDismiss={() => void dismiss(n)}
              onReschedule={() => void reschedule(n)}
            />
          ))
        )}
      </div>
    </>
  );

  return (
    <>
      {phone ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent
              side="bottom"
              aria-describedby={undefined}
              className="h-[68svh] gap-0 rounded-t-[28px] p-0"
            >
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={onOpenChange}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent
            align="end"
            sideOffset={8}
            className="flex h-[min(26rem,calc(100dvh-6rem))] w-[26rem] flex-col gap-0 overflow-hidden rounded-2xl p-0"
          >
            {panel}
          </PopoverContent>
        </Popover>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("Clear all notifications?")}</DialogTitle>
            <DialogDescription>
              {t("Every notification will be removed for good. This can't be undone.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmClear(false)}>
              {t("Cancel")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => void clearAll()}>
              {t("Clear all")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function InboxSkeleton() {
  return (
    <div>
      {SKELETON_ROWS.map((i) => (
        <div
          key={i}
          className="flex items-center gap-3.5 border-b border-border/70 px-4 py-3.5"
        >
          <Skeleton className="size-11 rounded-2xl" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={cn("h-4", i % 2 ? "w-3/5" : "w-4/5")} />
            <Skeleton className="h-3 w-2/5" />
          </div>
        </div>
      ))}
    </div>
  );
}
