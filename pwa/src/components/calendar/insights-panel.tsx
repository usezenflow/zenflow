import { useCallback, useEffect, useState } from "react";
import { addDays, format } from "date-fns";
import type { InsightsResponse } from "@zenflow/shared";
import { getInsights } from "@/api/me";
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

/** Focus map and buffers look back and ahead over this many days, ending today. */
const FOCUS_DAYS = 28;
/** The weekly recap covers this many days, ending today. */
const RECAP_DAYS = 7;

interface Insights {
  /** Covers `FOCUS_DAYS`: focus map and buffers. */
  focus: InsightsResponse;
  /** Covers `RECAP_DAYS`: weekly recap. */
  week: InsightsResponse;
}

/**
 * A pill under the Today card that opens the focus map, weekly recap and prep
 * buffers in a sheet. Both windows end on today in the user's timezone.
 */
export function InsightsPanel() {
  useLanguage();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const online = useConnectivity((s) => s.online);
  const isMobile = useIsMobile();
  const [insights, setInsights] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    const today = zonedNow(tz);
    const to = format(today, "yyyy-MM-dd");
    return Promise.all([
      getInsights(format(addDays(today, 1 - FOCUS_DAYS), "yyyy-MM-dd"), to),
      getInsights(format(addDays(today, 1 - RECAP_DAYS), "yyyy-MM-dd"), to),
    ])
      .then(([focus, week]) => {
        setInsights({ focus, week });
        setFailed(false);
      })
      .catch((error: unknown) => {
        setFailed(true);
        errorToast(apiErrorMessage(error, t("Could not load insights")));
      });
  }, [tz]);

  useEffect(() => {
    if (!online) return;
    void load();
    const refresh = () => void load();
    window.addEventListener("zenflow:calendar-refresh", refresh);
    return () => window.removeEventListener("zenflow:calendar-refresh", refresh);
  }, [load, online]);

  if (failed) return null;
  if (!insights) {
    return online ? <Skeleton className="h-9 w-28 rounded-full" /> : null;
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="self-start rounded-full border-border bg-card px-3.5 text-[13px] font-semibold"
      >
        {t("Insights")}
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "flex flex-col gap-0 p-0",
            isMobile ? "max-h-[88dvh] rounded-t-2xl" : "w-full sm:max-w-md",
          )}
        >
          <div className="px-5 pb-2 pt-5">
            <SheetTitle className="text-[20px] font-bold tracking-tight">{t("Insights")}</SheetTitle>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 pb-8">
            <FocusMap cells={insights.focus.focus} />
            <WeeklyRecapCard recap={insights.week.recap} />
            <BufferChips items={insights.focus.buffers} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
