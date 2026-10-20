import { eachDayOfInterval, endOfWeek, startOfWeek } from "date-fns";
import { format } from "@/lib/format";
import { MonthGrid } from "./month-grid";
import { Event } from "@zenflow/shared";
import { useState } from "react";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent } from "@dnd-kit/core";
import { TASK_CARD_CLASSES, WEEK_STARTS_ON } from "@zenflow/core";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/hooks/use-user-store";
import { useDragSensors } from "@/hooks/use-drag-sensors";
import { zonedDate, zonedWallClockToUtc } from "@/utils/tz";

export function MonthView({
  events,
  date,
  onOpenDay,
  setEvents,
  onReschedule,
}: {
  events: Event[];
  date: Date;
  onOpenDay: (day: Date) => void;
  setEvents: React.Dispatch<React.SetStateAction<Event[]>>;
  onReschedule: (taskId: string, startISO: string) => void;
}) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const sensors = useDragSensors();
  // The lifted chip is drawn by the overlay, above every cell, not in its cell.
  const [activeId, setActiveId] = useState<string | null>(null);
  const activeEvent = activeId ? events.find((e) => e.id === activeId) : undefined;
  const weekdays = eachDayOfInterval({
    start: startOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(new Date(), { weekStartsOn: WEEK_STARTS_ON }),
  });

  function onDragEnd({ over, active }: DragEndEvent) {
    if (!over) return;
    const activeId = active.id.toString();
    const block = events.find((e) => e.id === activeId);
    if (!block) return;
    // Droppable id is a 'YYYY-MM-DD' user-tz day. Keep the block's wall-clock
    // time-of-day, move it to that day in zoned space, then back to UTC.
    const [y, m, d] = over.id.toString().split("-").map(Number);
    const wall = zonedDate(block.start, tz);
    wall.setFullYear(y, m - 1, d);
    const newStart = zonedWallClockToUtc(wall, tz);
    const duration =
      new Date(block.end).getTime() - new Date(block.start).getTime();
    const newEnd = new Date(newStart.getTime() + duration);

    // No-op drop (released on the same day it started) — don't record a move.
    if (newStart.toISOString() === block.start) return;

    setEvents((evs) =>
      evs.map((ev) =>
        ev.id === activeId
          ? { ...ev, start: newStart.toISOString(), end: newEnd.toISOString() }
          : ev,
      ),
    );
    onReschedule(block.taskId, newStart.toISOString());
  }


  return (
    <div data-slot="month-view" className="flex min-h-full flex-col">
      {/* Weekday headers — sticky, frosted, weekend muted. */}
      <div className="bg-card/80 border-border sticky top-0 z-10 grid grid-cols-7 border-b backdrop-blur-md">
        {weekdays.map((day, i) => (
          <div
            key={day.toISOString()}
            className={cn(
              "py-2 text-center text-[11px] font-semibold",
              i >= 5 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {format(day, "eee")}
          </div>
        ))}
      </div>
      <DndContext
        sensors={sensors}
        onDragStart={({ active }: DragStartEvent) => setActiveId(active.id.toString())}
        onDragCancel={() => setActiveId(null)}
        onDragEnd={(event) => {
          setActiveId(null);
          onDragEnd(event);
        }}
      >
        <MonthGrid events={events} date={date} onOpenDay={onOpenDay} />
        <DragOverlay dropAnimation={null}>
          {activeEvent ? (
            <div
              className={cn(
                "w-40 cursor-grabbing rounded border border-l-2 bg-card px-1.5 py-0.5 text-[11px] font-medium shadow-lg",
                TASK_CARD_CLASSES[activeEvent.state],
              )}
            >
              <span className="block truncate">{activeEvent.title}</span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
