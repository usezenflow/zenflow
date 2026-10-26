import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ResolveRequest } from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { loadScheduleItems, type ScheduleItem } from "./day-load";
import { ConflictResolveService } from "./conflict-resolve.service";

jest.mock("./day-load", () => ({
  ...jest.requireActual<typeof import("./day-load")>("./day-load"),
  loadScheduleItems: jest.fn(),
}));

const HOUR = 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 22, 8);

const item = (
  id: string | null,
  start: number,
  durationMinutes: number,
  overrides: Partial<ScheduleItem> = {},
): ScheduleItem => ({
  id,
  type: "TASK",
  seriesId: null,
  recurring: false,
  start,
  end: start + durationMinutes * 60 * 1000,
  durationMinutes,
  deadlineMs: NOW + 3 * 24 * HOUR,
  moved: false,
  ...overrides,
});

const user = {
  id: "u1",
  timezone: "UTC",
  preferenceMatrix: new Array(168).fill(0),
} as unknown as User;

describe("ConflictResolveService", () => {
  let client: { resolve: jest.Mock };
  let displacement: { applyMoves: jest.Mock };
  let service: ConflictResolveService;
  const load = loadScheduleItems as jest.Mock;

  beforeEach(() => {
    client = { resolve: jest.fn() };
    displacement = { applyMoves: jest.fn().mockResolvedValue([]) };
    service = new ConflictResolveService(
      {} as never,
      client as never,
      displacement as never,
    );
  });

  it("is a no-op when nothing flexible overlaps the anchor", async () => {
    const anchor = item("a", NOW + 2 * HOUR, 60);
    load.mockResolvedValue([anchor, item("b", NOW + 5 * HOUR, 60)]);

    const res = await service.resolve(user, "a", new Date(NOW));

    expect(res).toEqual({ moved: [], lateSessionIds: [] });
    expect(client.resolve).not.toHaveBeenCalled();
    expect(displacement.applyMoves).not.toHaveBeenCalled();
  });

  it("throws not found for a session outside the window", async () => {
    load.mockResolvedValue([item("b", NOW + 2 * HOUR, 60)]);

    await expect(service.resolve(user, "a", new Date(NOW))).rejects.toThrow(
      NotFoundException,
    );
  });

  it("applies the repack as one undo group and keeps the anchor fixed", async () => {
    const anchor = item("a", NOW + 2 * HOUR, 60);
    const blocker = item("b", NOW + 2 * HOUR + 30 * 60 * 1000, 60);
    const fixed = item("f", NOW + 6 * HOUR, 60, { deadlineMs: null });
    load.mockResolvedValue([anchor, blocker, fixed]);
    client.resolve.mockResolvedValue({
      outcome: "RESOLVED",
      moves: [
        {
          id: "b",
          fromMs: blocker.start,
          toMs: NOW + 4 * HOUR,
          cost: 3,
        },
      ],
      lateIds: [],
    });

    const res = await service.resolve(user, "a", new Date(NOW));

    const sent = (client.resolve.mock.calls[0] as [ResolveRequest])[0];
    expect(sent.anchor).toEqual({ startMs: anchor.start, endMs: anchor.end });
    expect(sent.flexible.map((f) => f.id)).toEqual(["b"]);
    expect(sent.fixed.map((f) => f.startMs)).toContain(fixed.start);
    expect(displacement.applyMoves).toHaveBeenCalledWith(
      "u1",
      [{ id: "b", fromMs: blocker.start, toMs: NOW + 4 * HOUR }],
      expect.any(Function),
      expect.any(String),
    );
    expect(res.moved).toEqual(["b"]);
    expect(res.undoGroupId).toEqual(expect.any(String));
  });

  it("returns late ids without failing when the layout is late", async () => {
    const anchor = item("a", NOW + 2 * HOUR, 60);
    const blocker = item("b", NOW + 2 * HOUR, 60);
    load.mockResolvedValue([anchor, blocker]);
    client.resolve.mockResolvedValue({
      outcome: "RESOLVED",
      moves: [],
      lateIds: ["b"],
    });

    const res = await service.resolve(user, "a", new Date(NOW));

    expect(res).toEqual({ moved: [], lateSessionIds: ["b"] });
    expect(displacement.applyMoves).toHaveBeenCalledWith(
      "u1",
      [],
      expect.any(Function),
      expect.any(String),
    );
  });

  it("rejects when no layout fits", async () => {
    const anchor = item("a", NOW + 2 * HOUR, 60);
    const blocker = item("b", NOW + 2 * HOUR, 60);
    load.mockResolvedValue([anchor, blocker]);
    client.resolve.mockResolvedValue({
      outcome: "INFEASIBLE",
      moves: [],
      lateIds: [],
    });

    await expect(service.resolve(user, "a", new Date(NOW))).rejects.toThrow(
      ConflictException,
    );
    expect(displacement.applyMoves).not.toHaveBeenCalled();
  });

  it("is unavailable when the placer does not answer", async () => {
    const anchor = item("a", NOW + 2 * HOUR, 60);
    const blocker = item("b", NOW + 2 * HOUR, 60);
    load.mockResolvedValue([anchor, blocker]);
    client.resolve.mockResolvedValue(null);

    await expect(service.resolve(user, "a", new Date(NOW))).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
