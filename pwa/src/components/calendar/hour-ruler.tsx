import { hourLabel } from "@/lib/format";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const HOURS = Array.from({ length: 24 }, (_, i) => i);

/** Hour labels beside a day column: 0h at the top, midnight again at the bottom tagged "tomorrow". */
export function HourRuler() {
  return (
    <div className="bg-sidebar border-border relative border-r">
      {HOURS.map((hour) => (
        <div key={hour} className="relative h-[var(--week-cells-height)]">
          <span
            className={cn(
              "text-muted-foreground absolute right-0 w-full pe-2 text-right text-sm font-bold sm:pe-4",
              hour === 0 ? "top-0" : "-top-2.5",
            )}
          >
            {hourLabel(hour)}
          </span>
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 pe-2 text-right sm:pe-4">
        <span className="text-muted-foreground block text-sm font-bold">{hourLabel(0)}</span>
        <span className="text-primary block text-[9px] font-bold">{t("tomorrow")}</span>
      </div>
    </div>
  );
}
