import { Test, type TestingModule } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { API_TOKEN_ROUTE_KEY } from "../api-access/allow-api-token.decorator";
import { NoteFilesService } from "../files/note-files.service";
import { RemindersService } from "../reminders/reminders.service";
import { ConflictResolveService } from "../scheduler/io/conflict-resolve.service";
import { ScheduleInfeasibleException } from "../scheduler/schedule-infeasible.exception";
import { BulkCreateSessionsDto } from "./dto/bulk-create-sessions.dto";
import type { CreateSessionDto } from "./dto/create-session.dto";
import { SeriesService } from "./series.service";
import { SessionCrudService } from "./session-crud.service";
import { SessionSkipService } from "./session-skip.service";
import { SessionStartService } from "./session-start.service";
import { SessionDoneService } from "./session-done.service";
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
} as CreateSessionDto;

function bulk(
  items: CreateSessionDto[],
  dryRun?: boolean,
): BulkCreateSessionsDto {
  return { items, dryRun } as BulkCreateSessionsDto;
}

async function setup() {
  const crud = {
    create: jest.fn(),
    proposeCreate: jest.fn(),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      SessionsService,
      { provide: SessionCrudService, useValue: crud },
      { provide: SeriesService, useValue: {} },
      { provide: SessionUpdateService, useValue: {} },
      { provide: SlotPickService, useValue: {} },
      { provide: SessionSkipService, useValue: {} },
      { provide: ConflictResolveService, useValue: {} },
      { provide: SessionStartService, useValue: {} },
      {
        provide: SessionDoneService,
        useValue: { mark: jest.fn(), clear: jest.fn(), isDone: jest.fn() },
      },
      {
        provide: PlacementChipsService,
        useValue: { forTask: jest.fn().mockResolvedValue([]) },
      },
      {
        provide: RemindersService,
        useValue: {
          resolveForCreate: jest.fn().mockReturnValue([]),
          replace: jest.fn().mockResolvedValue({ applied: [], skipped: [] }),
        },
      },
      {
        provide: NoteFilesService,
        useValue: { normalize: jest.fn().mockResolvedValue(undefined) },
      },
    ],
  }).compile();
  return { service: module.get(SessionsService), crud };
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

describe("SessionsController API token routes", () => {
  const modeOf = (fn: unknown) =>
    Reflect.getMetadata(API_TOKEN_ROUTE_KEY, fn as object) as
      | string
      | undefined;

  it("lets bearer tokens read sessions", () => {
    const proto = SessionsController.prototype;
    expect(modeOf(proto.list)).toBe("allow");
    expect(modeOf(proto.search)).toBe("allow");
    expect(modeOf(proto.findOne)).toBe("allow");
  });

  it("accepts bearer only on the bulk create", () => {
    expect(modeOf(SessionsController.prototype.bulkCreate)).toBe("only");
  });

  it("refuses bearer tokens on every other route", () => {
    const proto = SessionsController.prototype;
    for (const fn of [
      proto.create,
      proto.update,
      proto.remove,
      proto.undoPlacement,
    ]) {
      expect(modeOf(fn)).toBeUndefined();
    }
  });
});
