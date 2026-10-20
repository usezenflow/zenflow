import { Skeleton } from "@/components/ui/skeleton";
import { t } from "@/lib/i18n";
import type { ViewMode } from "@zenflow/shared";

const ROWS = 10;
const COLUMNS: Record<ViewMode, number> = { day: 1, week: 7, month: 7 };

/** Placeholder grid shown while the first calendar load is in flight. */
export function ViewSkeleton({ view }: { view: ViewMode }) {
  const columns = COLUMNS[view];
  return (
    <div aria-busy="true" aria-label={t("Loading")} role="status" className="flex h-full flex-col gap-3 p-4">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {Array.from({ length: columns }, (_, i) => (
          <Skeleton key={`head-${i}`} className="h-4 w-full" />
        ))}
      </div>
      {Array.from({ length: ROWS }, (_, row) => (
        <div key={row} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }, (_, col) => (
            <Skeleton key={`${row}-${col}`} className="h-10 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}
