import { ChevronLeft, ChevronRight, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ViewModeSelect } from "./view-mode-select";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { endOfWeek, startOfMonth } from "date-fns";
import { formatTitle } from "@/lib/format";
import { t } from "@/lib/i18n";
import { Dispatch, SetStateAction } from "react";
import { ViewMode } from "@zenflow/shared";
import { Plus } from "lucide-react";
import { useUserStore } from "@/hooks/use-user-store";
import { zonedNow } from "@/utils/tz";
import { WEEK_STARTS_ON } from "@zenflow/core";
import { shiftDateByView, type NavDirection } from "@/utils/navigation";

interface CalendarHeaderProps {
  date: Date;
  setDate: Dispatch<SetStateAction<Date>>;
  currentView: ViewMode;
  setCurrentView: Dispatch<SetStateAction<ViewMode>>;
  /** Open the mobile nav drawer (hamburger is shown only below `lg`). */
  onOpenNav?: () => void;
  /** Open the session sheet on a new draft. */
  onNew: () => void;
}

export function CalendarHeader({
  date,
  setDate,
  currentView,
  setCurrentView,
  onOpenNav,
  onNew,
}: CalendarHeaderProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const shift = (direction: NavDirection) =>
    setDate((d) => shiftDateByView(d, currentView, direction));

  const formatByView = () => {
    switch (currentView) {
      case "day":
        return formatTitle(date, "EEE MMMM d, yyyy");
      case "week":
        return formatTitle(
          endOfWeek(date, { weekStartsOn: WEEK_STARTS_ON }),
          "MMMM yyyy",
        );
      case "month":
        return formatTitle(startOfMonth(date), "MMMM yyyy");
    }
  };

  const title = formatByView();

  return (
    <div className="flex h-16 items-center justify-between gap-2 border-b border-border py-4 bg-card px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-1 sm:gap-4">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onOpenNav}
          aria-label={t("Open navigation")}
        >
          <Menu className="size-4" />
        </Button>

        <Button
          className="hidden sm:flex"
          variant="outline"
          onClick={() => setDate(zonedNow(tz))}
        >
          {t("Today")}
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("shrink-0", currentView === "day" && "max-md:hidden")}
          onClick={() => shift("left")}
        >
          <ChevronLeft className="size-4" />
        </Button>

        <Button
          variant="ghost"
          size="icon-sm"
          className={cn("shrink-0", currentView === "day" && "max-md:hidden")}
          onClick={() => shift("right")}
        >
          <ChevronRight className="size-4" />
        </Button>

        <h2 className={cn("truncate text-sm font-semibold sm:text-lg", currentView === "day" && "max-md:hidden")}>
          <span key={title} className="block truncate animate-rise-in">
            {title}
          </span>
        </h2>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
        <NotificationBell />
        <ViewModeSelect value={currentView} onChange={setCurrentView} />
        <Button size="icon-sm" aria-label={t("New session")} onClick={onNew} className="sm:hidden">
          <Plus className="size-4" />
        </Button>
        <Button size="sm" onClick={onNew} className="hidden sm:inline-flex">
          <Plus className="size-4" /> {t("New session")}
        </Button>
      </div>
    </div>
  );
}
