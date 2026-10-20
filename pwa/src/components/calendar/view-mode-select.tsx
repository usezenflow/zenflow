import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { t } from "@/lib/i18n";
import { CalendarDays, CalendarRange, Calendar1 } from "lucide-react";
import { ViewMode } from "@zenflow/shared";

const ICONS = { day: Calendar1, week: CalendarRange, month: CalendarDays } as const;

const LABELS: Record<ViewMode, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
};

export function ViewModeSelect({
  value,
  onChange,
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ViewMode)}>
      <SelectTrigger className="w-24 sm:w-[140px]">
        <span className="flex items-center gap-2">
          {(() => {
            const Icon = ICONS[value];
            return <Icon className="size-4 text-muted-foreground" />;
          })()}
          {t(LABELS[value])}
        </span>
      </SelectTrigger>
      <SelectContent>
        <SelectItem className="flex flex-1 w-full justify-between" value="day">
          <span className="flex items-center gap-2"><Calendar1 className="size-4 text-muted-foreground" />{t("Day")}</span>
          <span className="text-muted-foreground tabular-nums">D</span>
        </SelectItem>
        <SelectItem className="flex w-full justify-between max-md:hidden" value="week">
          <span className="flex items-center gap-2"><CalendarRange className="size-4 text-muted-foreground" />{t("Week")}</span>
          <span className="text-muted-foreground tabular-nums">W</span>
        </SelectItem>
        <SelectItem className="flex w-full justify-between" value="month">
          <span className="flex items-center gap-2"><CalendarDays className="size-4 text-muted-foreground" />{t("Month")}</span>
          <span className="text-muted-foreground tabular-nums">M</span>
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
