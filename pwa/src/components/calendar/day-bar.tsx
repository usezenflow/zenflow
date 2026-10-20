import { SESSION_TONES, SESSION_TYPE_TONE } from "@zenflow/core";
import type { DayBar } from "@/lib/day-bar";

/**
 * A day's load as one thin rounded bar on a fixed 24 hour track: muted for free
 * time, a tinted stretch (by session type) where a session sits.
 */
export function DayBarView({ bar, height = 4 }: { bar?: DayBar; height?: number }) {
  return (
    <div
      aria-hidden
      className="relative w-full overflow-hidden bg-muted-foreground/30"
      style={{ height, borderRadius: height / 2 }}
    >
      {bar?.segments.map((segment) => (
        <div
          key={`${segment.start}-${segment.kind}`}
          className="absolute top-0 bottom-0"
          style={{
            left: `${(segment.start / 1440) * 100}%`,
            width: `${((segment.end - segment.start) / 1440) * 100}%`,
            minWidth: 3,
            backgroundColor: SESSION_TONES[SESSION_TYPE_TONE[segment.kind]].base,
          }}
        />
      ))}
    </div>
  );
}
