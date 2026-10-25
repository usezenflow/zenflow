import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, format } from "date-fns";
import { ChartNoAxesColumn } from "lucide-react";
import type { InsightsResponse } from "@zenflow/shared";
import { getInsights } from "@/api/me";
import { ErrorMark } from "@/components/brand/state-marks";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserStore } from "@/hooks/use-user-store";
import { useConnectivity } from "@/lib/connectivity";
import { t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { zonedNow } from "@/utils/tz";
import { FocusMap } from "./focus-map";
import { BufferChips, WeeklyRecapCard } from "./recap-and-buffers";

const FOCUS_DAYS = 28;
const RECAP_DAYS = 7;

interface Insights {
  focus: InsightsResponse;
  week: InsightsResponse;
}

export function InsightsSheet() {
  useLanguage();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const online = useConnectivity((s) => s.online);
  const isMobile = useIsMobile();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);

  const load = useCallback(async () => {
    if (!online) return;
    const today = zonedNow(tz);
    const to = format(today, "yyyy-MM-dd");
    try {
      const [focus, week] = await Promise.all([
        getInsights(format(addDays(today, 1 - FOCUS_DAYS), "yyyy-MM-dd"), to),
        getInsights(format(addDays(today, 1 - RECAP_DAYS), "yyyy-MM-dd"), to),
      ]);
      setInsights({ focus, week });
      setFailed(false);
    } catch (error) {
      setFailed(true);
      errorToast(apiErrorMessage(error, t("Could not load insights")));
    }
  }, [tz, online]);

  useEffect(() => {
    if (!online) return;
    void load();
    const refresh = () => void load();
    window.addEventListener("zenflow:calendar-refresh", refresh);
    return () => window.removeEventListener("zenflow:calendar-refresh", refresh);
  }, [load, online]);

  // Listen for global open event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("zenflow:open-insights", handler);
    return () => window.removeEventListener("zenflow:open-insights", handler);
  }, []);

  // Auto-load when mounted and online
  useEffect(() => {
    if (online && !mountedRef.current) {
      mountedRef.current = true;
      void load();
    }
  }, [online, load]);

  if (failed) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "flex flex-col gap-0 p-0",
            isMobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-md",
          )}
        >
          <div className="relative overflow-hidden px-5 pb-4 pt-5">
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-br from-sky-200/70 via-indigo-100/60 to-violet-200/60 dark:from-sky-900/50 dark:via-indigo-900/40 dark:to-violet-900/40"
            />
            <div className="relative flex items-center gap-3">
              <ErrorMark size={44} />
              <SheetTitle className="text-[20px] font-bold tracking-tight">{t("Insights")}</SheetTitle>
            </div>
          </div>
          <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3.5">
            <ErrorMark size={40} />
            <p className="min-w-0 flex-1 text-[14px] text-muted-foreground">{t("Couldn't load insights")}</p>
            <Button variant="outline" size="sm" onClick={() => void load()}>
              {t("Try again")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  if (!insights) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "flex flex-col gap-0 p-0",
            isMobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-md",
          )}
        >
          <div className="relative overflow-hidden px-5 pb-4 pt-5">
            <div
              aria-hidden
              className="absolute inset-0 bg-gradient-to-br from-sky-200/70 via-indigo-100/60 to-violet-200/60 dark:from-sky-900/50 dark:via-indigo-900/40 dark:to-violet-900/40"
            />
            <div className="relative flex items-center gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <ChartNoAxesColumn className="size-5" aria-hidden />
              </div>
              <SheetTitle className="text-[20px] font-bold tracking-tight">{t("Insights")}</SheetTitle>
            </div>
          </div>
          {online ? <Skeleton className="h-[72px] w-full rounded-2xl" /> : null}
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-md",
        )}
      >
        <div className="relative overflow-hidden px-5 pb-4 pt-5">
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-br from-sky-200/70 via-indigo-100/60 to-violet-200/60 dark:from-sky-900/50 dark:via-indigo-900/40 dark:to-violet-900/40"
          />
          <div className="relative flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ChartNoAxesColumn className="size-5" aria-hidden />
            </div>
            <SheetTitle className="text-[20px] font-bold tracking-tight">{t("Insights")}</SheetTitle>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-8">
          <FocusMap cells={insights.focus.focus} />
          <WeeklyRecapCard recap={insights.week.recap} />
          <BufferChips items={insights.focus.buffers} />
        </div>
      </SheetContent>
    </Sheet>
  );
}