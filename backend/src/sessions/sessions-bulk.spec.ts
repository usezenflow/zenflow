import { NotFoundException } from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { API_TOKEN_ROUTE_KEY } from "../api-access/allow-api-token.decorator";
import { CalendarSyncTrigger } from "../google-calendar/calendar-sync-trigger.service";
import { ConflictResolveService } from "../scheduler/io/conflict-resolve.service";
import { ScheduleInfeasibleException } from "../scheduler/schedule-infeasible.exception";
import { BulkCreateSessionsDto } from "./dto/bulk-create-sessions.dto";
import type { BulkDeleteSessionsDto } from "./dto/bulk-delete-sessions.dto";
import type { CreateSessionDto } from "./dto/create-session.dto";
import { SeriesService } from "./series.service";
import { SessionCrudService } from "./session-crud.service";
import { PlacementChipsService } from "./placement-chips.service";
import { SessionUpdateService } from "./session-update.service";
import { SlotPickService } from "./slot-pick.service";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";

const USER = { id: "u1", timezone: "UTC", lang: "EN_US" } as User;
const TASK: CreateSessionDto = {
  type: "TASK",
  title: "Essay",
  durationMinutes: 60,
  deadline: "2026-10-30T00:00:00.000Z",
};

function bulk(
  items: CreateSessionDto[],
  dryRun?: boolean,
): BulkCreateSessionsDto {
  return { items, dryRun };
}

async function setup() {
  const crud = {
    create: jest.fn(),
    proposeCreate: jest.fn(),
    remove: jest.fn(),
    removeTimetableGroup: jest.fn(),
    removeTimetableGroupFrom: jest.fn(),
    describeDelete: jest.fn(),
  };
  const series = { removeSeries: jest.fn() };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionsService,
      { provide: SessionCrudService, useValue: crud },
      { provide: SeriesService, useValue: series },
      { provide: SessionUpdateService, useValue: {} },
      { provide: SlotPickService, useValue: {} },
      { provide: ConflictResolveService, useValue: {} },
      {
        provide: PlacementChipsService,
        useValue: { forTask: jest.fn().mockResolvedValue([]) },
      },
      { provide: CalendarSyncTrigger, useValue: { request: jest.fn() } },
    ],
  }).compile();
  return { service: module.get(SessionsService), crud, series };
}

describe("SessionsService.bulkCreate", () => {
  it("creates each item in order and reports a failing item without stopping the rest", async () => {
    const { service, crud } = await setup();
    crud.create
      .mockResolvedValueOnce({
        id: "s1",
        scheduledStartTime: new Date("2026-10-26T01:00:00.000Z"),
      })
      .mockRejectedValueOnce(new ScheduleInfeasibleException())
      .mockResolvedValueOnce({ id: "s3", scheduledStartTime: null });

    const got = await service.bulkCreate(bulk([TASK, TASK, TASK]), USER);

    expect(got.dryRun).toBe(false);
    expect(got.results).toEqual([
      {
        index: 0,
        status: "CREATED",
        id: "s1",
        scheduledStartTime: "2026-10-26T01:00:00.000Z",
      },
      expect.objectContaining({
        index: 1,
        status: "ERROR",
        code: "SCHEDULE_INFEASIBLE",
      }),
      { index: 2, status: "CREATED", id: "s3", scheduledStartTime: null },
    ]);
    expect(crud.create).toHaveBeenCalledTimes(3);
  });

  it("proposes each start without calling create on a dry run", async () => {
    const { service, crud } = await setup();
    crud.proposeCreate
      .mockResolvedValueOnce(new Date("2026-10-26T01:00:00.000Z"))
      .mockResolvedValueOnce(null);

    const got = await service.bulkCreate(bulk([TASK, TASK], true), USER);

    expect(crud.create).not.toHaveBeenCalled();
    expect(got).toEqual({
      dryRun: true,
      results: [
        {
          index: 0,
          status: "PROPOSED",
          proposedStart: "2026-10-26T01:00:00.000Z",
        },
        { index: 1, status: "PROPOSED", proposedStart: null },
      ],
    });
  });

  it("reports the same error code on a dry run as the create would", async () => {
    const { service, crud } = await setup();
    crud.proposeCreate.mockRejectedValueOnce(new ScheduleInfeasibleException());

    const got = await service.bulkCreate(bulk([TASK], true), USER);

    expect(got.results[0]).toEqual(
      expect.objectContaining({ status: "ERROR", code: "SCHEDULE_INFEASIBLE" }),
    );
  });

  it("reports an unexpected failure as an internal error on that item", async () => {
    const { service, crud } = await setup();
    crud.create.mockRejectedValueOnce(new Error("db down"));

    const got = await service.bulkCreate(bulk([TASK]), USER);

    expect(got.results).toEqual([
      {
        index: 0,
        status: "ERROR",
        code: "INTERNAL_ERROR",
        message: "Couldn't create this session.",
      },
    ]);
  });
});

describe("SessionsService.bulkDelete", () => {
  const del = (
    items: BulkDeleteSessionsDto["items"],
    dryRun?: boolean,
  ): BulkDeleteSessionsDto => ({ items, dryRun });

  it("deletes a session, a series and a timetable group and counts what went", async () => {
    const { service, crud, series } = await setup();
    crud.remove.mockResolvedValue({ id: "s1" });
    series.removeSeries.mockResolvedValue({
      seriesId: "ser1",
      removedSessionIds: ["a"],
      seriesGone: true,
    });
    crud.removeTimetableGroup.mockResolvedValue({
      removedSessionIds: ["m1", "m2", "m3"],
    });

    const got = await service.bulkDelete(
      del([
        { kind: "session", id: "s1" },
        { kind: "series", id: "ser1" },
        { kind: "timetable", id: "t1" },
      ]),
      USER,
    );

    expect(got.dryRun).toBe(false);
    expect(got.results).toEqual([
      { index: 0, status: "DELETED", kind: "session", id: "s1", removed: 1 },
      { index: 1, status: "DELETED", kind: "series", id: "ser1", removed: 1 },
      { index: 2, status: "DELETED", kind: "timetable", id: "t1", removed: 3 },
    ]);
  });

  it("deletes a timetable from one meeting onward when asked", async () => {
    const { service, crud } = await setup();
    crud.removeTimetableGroupFrom.mockResolvedValue({
      removedSessionIds: ["m2", "m3"],
    });

    const got = await service.bulkDelete(
      del([{ kind: "timetable", id: "m2", scope: "following" }]),
      USER,
    );

    expect(crud.removeTimetableGroupFrom).toHaveBeenCalledWith("m2", USER);
    expect(crud.removeTimetableGroup).not.toHaveBeenCalled();
    expect(got.results[0]).toMatchObject({ status: "DELETED", removed: 2 });
  });

  it("previews without deleting", async () => {
    const { service, crud, series } = await setup();
    crud.describeDelete.mockResolvedValue({ title: "Algorithms", count: 14 });

    const got = await service.bulkDelete(
      del([{ kind: "timetable", id: "t1", scope: "all" }], true),
      USER,
    );

    expect(got).toEqual({
      dryRun: true,
      results: [
        {
          index: 0,
          status: "PREVIEW",
          kind: "timetable",
          id: "t1",
          title: "Algorithms",
          count: 14,
        },
      ],
    });
    expect(crud.describeDelete).toHaveBeenCalledWith(
      "timetable",
      "t1",
      "all",
      USER,
    );
    expect(crud.removeTimetableGroup).not.toHaveBeenCalled();
    expect(series.removeSeries).not.toHaveBeenCalled();
  });

  it("reports a failing item and still deletes the rest", async () => {
    const { service, crud } = await setup();
    crud.remove
      .mockRejectedValueOnce(
        new NotFoundException("Cannot find session with id nope"),
      )
      .mockResolvedValueOnce({ id: "s2" });

    const got = await service.bulkDelete(
      del([
        { kind: "session", id: "nope" },
        { kind: "session", id: "s2" },
      ]),
      USER,
    );

    expect(got.results).toEqual([
      expect.objectContaining({
        index: 0,
        status: "ERROR",
        message: "Cannot find session with id nope",
      }),
      { index: 1, status: "DELETED", kind: "session", id: "s2", removed: 1 },
    ]);
  });
});

describe("SessionsController API token routes", () => {
  const modeOf = (name: keyof SessionsController) =>
    Reflect.getMetadata(
      API_TOKEN_ROUTE_KEY,
      Object.getOwnPropertyDescriptor(SessionsController.prototype, name)
        ?.value as object,
    ) as string | undefined;

  it("lets bearer tokens read sessions", () => {
    expect(modeOf("list")).toBe("allow");
    expect(modeOf("findOne")).toBe("allow");
  });

  it("accepts bearer only on the bulk create and bulk delete", () => {
    expect(modeOf("bulkCreate")).toBe("only");
    expect(modeOf("bulkDelete")).toBe("only");
  });

  it("refuses bearer tokens on every other route", () => {
    for (const name of [
      "create",
      "update",
      "remove",
      "undoPlacement",
    ] as const) {
      expect(modeOf(name)).toBeUndefined();
    }
  });
});
