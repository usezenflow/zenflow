import { useEffect, useState } from "react";
import { addDays, startOfWeek } from "date-fns";
import { Sparkles } from "lucide-react";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { getPreferenceMatrix } from "@/api/users";
import { format } from "@/lib/format";
import { getLanguage, locale, t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { PreferenceMatrixResponse } from "@zenflow/shared";

// ---------------------------------------------------------------------------
// Preference heatmap
// ---------------------------------------------------------------------------

/** Rows are the 24 hours of the day; each maps directly to one matrix block. */
const HOURS = 24;
/** Row height (px) and inter-cell gap; the hour-label gutter width. */
const ROW_H = 22;
const GAP = 3;
const GUTTER = 46;

/** Short weekday for column `d` (0 = Monday), in the app language. */
function dayLabel(d: number) {
  return format(addDays(startOfWeek(new Date(), { weekStartsOn: 1 }), d), "EEE");
}

/** Compact hour label: "9 AM" in English, "9h" in Vietnamese. */
function hourLabel(h: number) {
  return getLanguage() === "vi" ? `${h}h` : format(new Date(2000, 0, 1, h), "h a");
}

/** Average score as a signed, one-decimal number in the app locale. */
function scoreLabel(score: number) {
  const sign = score > 0 ? "+" : "";
  return `${sign}${score.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

/**
 * Discrete diverging scale: positive (preferred) scores climb an orange ramp,
 * negative (avoided) scores climb a blue ramp, both deepening with magnitude
 * relative to the matrix's peak. A zero / cold cell reads as neutral. Full
 * literal class names so Tailwind's scanner emits them.
 */
const SCALE = [
  "bg-lime-100",
  "bg-lime-200",
  "bg-lime-300",
  "bg-lime-400",
  "bg-lime-500",
  "bg-lime-600",
  "bg-lime-700",
  "bg-lime-800",
  "bg-lime-900",
];

const NEUTRAL_CLASS = "bg-muted";

function cellClass(score: number, peak: number) {
  if (score <= 0 || peak === 0) return NEUTRAL_CLASS;
  const intensity = Math.min(1, Math.abs(score) / peak);
  // intensity in (0,1] → step 0..8 (at least the lightest shade when nonzero).
  const step = Math.min(8, Math.max(0, Math.ceil(intensity * 9) - 1));
  return SCALE[step];
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

/**
 * The 7×24 signed preference heatmap, shown under Advanced. Fetches on mount
 * and degrades gracefully (spinner, then error card, then cold-start empty state).
 */
export function UserPreferencesPanel() {
  useLanguage();
  const [heatmapData, setHeatmapData] = useState<PreferenceMatrixResponse | null>(null);
  const [heatmapLoading, setHeatmapLoading] = useState(true);
  const [heatmapError, setHeatmapError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    setHeatmapLoading(true);
    setHeatmapError(null);
    getPreferenceMatrix()
      .then((res) => {
        if (alive) setHeatmapData(res);
      })
      .catch((e) => {
        if (alive) setHeatmapError(apiErrorMessage(e, t("Couldn't load your preference map")));
      })
      .finally(() => {
        if (alive) setHeatmapLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  function renderHeatmap() {
    if (heatmapLoading) {
      return (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <DelayedSpinner busy={heatmapLoading} className="size-5" />
        </div>
      );
    }

    if (heatmapError) {
      return (
        <div className="rounded-md border border-border bg-muted/40 p-4 text-xs text-muted-foreground">
          {heatmapError}
        </div>
      );
    }

    const matrix = heatmapData?.matrix ?? [];
    const days = heatmapData?.days ?? 7;
    const blocks = heatmapData?.blocks ?? 24;

    /** Signed score for hour `h` of day column `d` (direct 1:1 cell lookup). */
    function hourScore(d: number, h: number) {
      return h < blocks ? (matrix[d * blocks + h] ?? 0) : 0;
    }

    let peak = 0;
    for (let d = 0; d < days; d++) {
      for (let h = 0; h < HOURS; h++) {
        peak = Math.max(peak, Math.abs(hourScore(d, h)));
      }
    }

    // Cold start: the matrix exists but carries no signal yet.
    if (peak === 0) {
      return (
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/30 p-8 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-primary/30 bg-primary/10">
            <Sparkles className="size-4 text-primary" />
          </span>
          <p className="text-sm font-semibold">{t("No preferences learned yet")}</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {t("Zenflow learns from the tasks you move.")}
          </p>
        </div>
      );
    }

    return (
      <div className="space-y-3">
        {/* Legend (top) */}
        <div className="flex items-center justify-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-3 w-3 rounded-[3px] border border-border/60 bg-muted" />
            {t("Neutral")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex gap-1">
              {[2, 4, 6, 8].map((s) => (
                <span key={s} className={cn("inline-block h-3 w-3 rounded-[3px]", SCALE[s])} />
              ))}
            </span>
            {t("Prefer")}
          </span>
        </div>

        {/* Day-column header */}
        <div className="flex" style={{ gap: GAP }}>
          <div className="shrink-0" style={{ width: GUTTER }} />
          {Array.from({ length: days }).map((_, d) => (
            <div key={d} className="flex-1 text-center text-[11px] font-medium text-muted-foreground">
              {dayLabel(d)}
            </div>
          ))}
        </div>

        {/* Hour rows × day columns */}
        <div className="flex flex-col" style={{ gap: GAP }}>
          {Array.from({ length: HOURS }).map((_, h) => (
            <div key={h} className="flex items-center" style={{ gap: GAP }}>
              <div
                className="shrink-0 pr-1 text-right text-[11px] tabular-nums leading-none text-muted-foreground"
                style={{ width: GUTTER }}
              >
                {hourLabel(h)}
              </div>
              {Array.from({ length: days }).map((_, d) => {
                const score = hourScore(d, h);
                return (
                  <div
                    key={d}
                    className={cn(
                      "flex-1 rounded-[3px] border border-border/60 transition-shadow hover:ring-1 hover:ring-ring",
                      cellClass(score, peak),
                    )}
                    style={{ height: ROW_H }}
                    title={t("{day} {hour}, average {score}", {
                      day: dayLabel(d),
                      hour: hourLabel(h),
                      score: scoreLabel(score),
                    })}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return renderHeatmap();
}
