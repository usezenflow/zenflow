import { useMemo, useState } from "react";
import { Shell } from "@/components/shell";
import { Card, Empty, LoadingGrid } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useViewState } from "@/lib/view-state";
import { MIN_GROUP, workload, type WorkloadDimension } from "./fixtures";

const DIMENSIONS: [WorkloadDimension, string][] = [
  ["faculty", "Faculty"],
  ["className", "Class"],
  ["cohort", "Cohort"],
];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 16 }, (_, i) => i + 6);

export function Workload() {
  const [state] = useViewState();
  const [dimension, setDimension] = useState<WorkloadDimension>("faculty");
  const groups = useMemo(() => workload.filter((g) => g.dimension === dimension), [dimension]);
  const shown = groups.filter((g) => g.students >= MIN_GROUP);
  const [value, setValue] = useState<string | null>(null);
  const group = shown.find((g) => g.value === value) ?? shown[0];

  const perStudent = group ? group.minutes.map((d) => d.map((m) => m / group.students)) : [];
  const max = Math.max(1, ...perStudent.flat());

  return (
    <Shell title="Workload" subtitle="Scheduled minutes per student by weekday and hour">
      {state === "loading" && <LoadingGrid tiles={1} />}
      {state === "empty" && <Empty title="No sessions yet" body="The heatmap fills as students schedule." />}
      {state === "ready" && group && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-md border p-0.5 text-sm" role="group" aria-label="Group by">
              {DIMENSIONS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    setDimension(key);
                    setValue(null);
                  }}
                  className={cn("rounded px-3 py-1", dimension === key ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  {label}
                </button>
              ))}
            </div>
            <select
              aria-label="Group"
              value={group.value}
              onChange={(e) => setValue(e.target.value)}
              className="rounded-md border bg-card px-3 py-1.5 text-sm"
            >
              {shown.map((g) => (
                <option key={g.value} value={g.value}>
                  {`${g.value} (${g.students})`}
                </option>
              ))}
            </select>
            {groups.length > shown.length && (
              <p className="text-xs text-muted-foreground">{`Hidden: groups under ${MIN_GROUP} students`}</p>
            )}
          </div>
          <Card title={group.value} hint={`${group.students} students, average minutes per student`}>
            <div className="overflow-x-auto">
              <div className="grid min-w-[560px] gap-1" style={{ gridTemplateColumns: `3rem repeat(${HOURS.length}, minmax(0, 1fr))` }}>
                <div />
                {HOURS.map((h) => (
                  <div key={h} className="text-center text-[11px] text-muted-foreground">{h}</div>
                ))}
                {DAYS.map((day, d) => (
                  <div key={day} className="contents">
                    <div className="flex items-center text-xs text-muted-foreground">{day}</div>
                    {HOURS.map((h) => {
                      const v = perStudent[d][h];
                      return (
                        <div
                          key={h}
                          title={`${day} ${h}:00, ${Math.round(v)} min`}
                          className="aspect-square rounded-sm bg-muted"
                          style={v > 0 ? { background: `color-mix(in oklch, var(--brand-orange) ${Math.round((v / max) * 100)}%, var(--muted))` } : undefined}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <span>Light</span>
              <div className="h-2 w-24 rounded-full" style={{ background: "linear-gradient(90deg, var(--muted), var(--brand-orange))" }} />
              <span>{`Busy, ${Math.round(max)} min`}</span>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
