import { useSyncExternalStore } from "react";
import { Clock, Hand, Lock } from "lucide-react";
import type { ConfirmPlacementResponse, PlacementPlan, Session } from "@zenflow/shared";
import { zonedDate } from "@zenflow/core";
import { confirmPlacement, getSessionDetails, undoPlacement } from "@/api/tasks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { format } from "@/lib/format";
import { t, useLanguage } from "@/lib/i18n";
import { type RoomRow, roomTimelines } from "@/lib/make-room";
import { showMovedToast } from "@/lib/move-toast";
import { errorToast } from "@/lib/toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserStore } from "@/hooks/use-user-store";
import { cn } from "@/lib/utils";

/** One button in the sheet. The sheet closes first, then `run` is called. */
export interface MakeRoomAction {
  id: string;
  label: string;
  variant?: "default" | "outline" | "ghost";
  run: () => void | Promise<void>;
}

export interface MakeRoomRequest {
  /** The one-line subtitle, already translated. */
  subtitle: string;
  plan: PlacementPlan;
  /** Title and length of the session being placed, when the plan creates it. */
  title: string;
  durationMinutes: number;
  /** Sessions the plan moves, for their titles and lengths. */
  sessions: Session[];
  actions: MakeRoomAction[];
}

// A single open request, shared through a store so any screen can open the sheet.
let current: MakeRoomRequest | null = null;
const listeners = new Set<() => void>();

function setCurrent(next: MakeRoomRequest | null) {
  current = next;
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Shows the Make room sheet for a plan. Nothing is applied until an action runs. */
export function openMakeRoom(request: MakeRoomRequest) {
  setCurrent(request);
}

function timeOf(iso: string, tz: string, pattern = "HH:mm"): string {
  return format(zonedDate(iso, tz), pattern);
}

function TimelineRow({ row, tz }: { row: RoomRow; tz: string }) {
  const Icon = row.moved ? Clock : Hand;
  const end = new Date(new Date(row.start).getTime() + row.durationMinutes * 60_000);
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border px-3 py-2.5",
        row.moved ? "border-border bg-muted/40" : "border-primary/40 bg-primary/10",
      )}
    >
      <Icon className={cn("size-4 shrink-0", row.moved ? "text-muted-foreground" : "text-primary")} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{row.title || t("Session")}</p>
        <p className="text-[12px] text-muted-foreground">
          {t("{start} to {end}", {
            start: timeOf(row.start, tz, "EEE d MMM, HH:mm"),
            end: timeOf(end.toISOString(), tz),
          })}
        </p>
      </div>
    </div>
  );
}

function Timeline({ label, rows, tz }: { label: string; rows: RoomRow[]; tz: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-semibold text-muted-foreground">{label}</h3>
      {rows.map((row) => (
        <TimelineRow key={`${row.id}-${row.start}`} row={row} tz={tz} />
      ))}
    </section>
  );
}

/**
 * Make room: a placement that moves a session the user chose needs their
 * go-ahead. Shows the timeline before and after the plan, then the actions.
 */
export function MakeRoomSheet() {
  useLanguage();
  const isMobile = useIsMobile();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const request = useSyncExternalStore(subscribe, () => current, () => current);

  const close = () => setCurrent(null);
  const run = (action: MakeRoomAction) => {
    close();
    void action.run();
  };

  const timelines = request
    ? roomTimelines(request.plan, request.sessions, request.title, request.durationMinutes)
    : null;

  return (
    <Sheet open={request !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-0 p-0", isMobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-md")}
      >
        {request && timelines ? (
          <>
            <div className="flex flex-col gap-1 border-b border-border px-5 py-4">
              <SheetTitle className="text-[20px] font-bold tracking-tight">{t("Make room")}</SheetTitle>
              <SheetDescription className="text-[13px] text-muted-foreground">{request.subtitle}</SheetDescription>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">
              <Timeline label={t("Before")} rows={timelines.before} tz={tz} />
              <Timeline label={t("After")} rows={timelines.after} tz={tz} />
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Lock className="size-3 shrink-0" aria-hidden />
                {t("Pinned and fixed sessions never move.")}
              </p>
            </div>
            <div className="flex flex-col gap-2 border-t border-border px-5 py-4">
              {request.actions.map((action) => (
                <Button
                  key={action.id}
                  variant={action.variant ?? "default"}
                  onClick={() => run(action)}
                  className="w-full"
                >
                  {action.label}
                </Button>
              ))}
            </div>
          </>
        ) : (
          <SheetTitle className="sr-only">{t("Make room")}</SheetTitle>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Opens Make room for a 409 plan. Loads the sessions it moves so the timeline
 * has their names, then offers: move (confirm, with an Undo toast), accept
 * late (creates only), or pick another time (closes).
 */
export async function openPlacementPlan(opts: {
  plan: PlacementPlan;
  subtitle: string;
  title: string;
  durationMinutes: number;
  /** Applies the placed session once the plan is confirmed. */
  onConfirmed: (res: ConfirmPlacementResponse) => void;
  /** Runs after an Undo of the confirmed plan, so the caller can reload. */
  onUndone: () => void;
  /** Keep the requested time and accept it lands after the deadline. Creates only. */
  onLate?: () => void;
}) {
  const moved = await Promise.all(
    opts.plan.moves.map((move) => getSessionDetails(move.id).catch(() => null)),
  );
  const actions: MakeRoomAction[] = [
    {
      id: "move",
      label: t("Move it"),
      run: async () => {
        try {
          const confirmed = await confirmPlacement(opts.plan.id);
          if (confirmed.session.scheduledStartTime) {
            showMovedToast({
              to: zonedDate(confirmed.session.scheduledStartTime, useUserStore.getState().user?.timezone || "UTC"),
              withTime: true,
              onUndo: () =>
                void undoPlacement(confirmed.undoGroupId)
                  .then(() => opts.onUndone())
                  .catch(() => errorToast(t("Couldn't move this session"))),
            });
          }
          opts.onConfirmed(confirmed);
        } catch {
          errorToast(t("The plan changed. Try again."));
        }
      },
    },
  ];
  if (opts.onLate) {
    actions.push({
      id: "late",
      label: t("Keep mine and accept late"),
      variant: "outline",
      run: opts.onLate,
    });
  }
  actions.push({ id: "pick", label: t("Pick another time"), variant: "ghost", run: () => {} });

  openMakeRoom({
    subtitle: opts.subtitle,
    plan: opts.plan,
    title: opts.title,
    durationMinutes: opts.durationMinutes,
    sessions: moved.filter((s): s is NonNullable<typeof s> => s !== null),
    actions,
  });
}
