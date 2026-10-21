import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SessionBlock } from "@/components/calendar/task-block";
import { buildDayGrid } from "@/lib/day-grid";
import { renderScreen } from "@/test/utils/render";
import type { DaySegment } from "@zenflow/shared";

const TZ = "UTC";
const GRID = buildDayGrid(56);
const START = "2026-10-15T09:00:00.000Z";

function segment(id: string): DaySegment {
  const end = "2026-10-15T10:00:00.000Z";
  return {
    id,
    segmentId: id,
    taskId: id,
    title: "Essay draft",
    start: START,
    end,
    taskStart: START,
    taskEnd: end,
    type: "TASK",
    tags: [],
    state: "fluid",
    location: null,
    originLocation: null,
  } as DaySegment;
}

function renderBlock(skipped: boolean) {
  return renderScreen(
    <SessionBlock
      segment={segment("b1")}
      layout={{ column: 0, columns: 1, conflict: false }}
      tz={TZ}
      grid={GRID}
      leftOffset={0}
      blockWidth={300}
      skipped={skipped}
      titleOnly
    />,
  );
}

describe("SessionBlock skip mark", () => {
  it("shows a skip mark on a skipped session", () => {
    renderBlock(true);
    expect(screen.getByTestId("skip-mark.b1")).toBeTruthy();
  });

  it("shows no skip mark on an open session", () => {
    renderBlock(false);
    expect(screen.queryByTestId("skip-mark.b1")).toBeNull();
  });
});
