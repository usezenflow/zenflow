import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DEFAULT_USER_NAME } from "@zenflow/shared";
import { NotificationsService } from "../notifications/notifications.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { parseMarks, parseStudentInfo } from "./core/parse-student";
import { PortalSessionService } from "./portal-session.service";
import { StudentSyncService } from "./student-sync.service";
import { UpstreamSessionCache } from "../integrations/upstream-session-cache.service";

jest.mock("./core/parse-student", () => ({
  ...jest.requireActual<Record<string, unknown>>("./core/parse-student"),
  parseStudentInfo: jest.fn(),
  parseMarks: jest.fn(),
}));

const INFO = {
  fullName: "Nguyễn Văn An",
  studentCode: "2012345",
  className: "CNTT K20",
  cohortYear: 2020,
} as unknown as ReturnType<typeof parseStudentInfo>;

async function setup() {
  const prisma = {
    studentProfile: { upsert: jest.fn().mockResolvedValue({}) },
    studyProgram: { upsert: jest.fn().mockResolvedValue({}) },
    user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const module = await Test.createTestingModule({
    providers: [
      { provide: UpstreamSessionCache, useValue: passThroughSessionCache },
      StudentSyncService,
      { provide: PrismaService, useValue: prisma },
      {
        provide: ConfigService,
        useValue: {
          get: (key: string) =>
            key === "INGESTION_REQUEST_DELAY_MS" ? 0 : undefined,
        },
      },
      {
        provide: PortalAPIService,
        useValue: {
          fetchStudentInfo: jest.fn().mockResolvedValue({}),
          fetchStudyPrograms: jest.fn().mockResolvedValue([]),
        },
      },
      {
        provide: PortalSessionService,
        useValue: {
          withToken: jest.fn(
            (_userId: string, use: (t: string) => Promise<unknown>) =>
              use("token").then((value) => ({ ok: true, value })),
          ),
        },
      },
      { provide: QueueService, useValue: { enqueueBestEffort: jest.fn() } },
      { provide: NotificationsService, useValue: {} },
    ],
  }).compile();
  return { prisma, service: module.get(StudentSyncService) };
}

const DATA = { userId: "u1", integrationId: "i1" };

/** A session cache that always signs in, so these specs run without Redis. */
const passThroughSessionCache = {
  getOrLogin: (_userId: string, _kind: string, login: () => Promise<unknown>) =>
    login(),
  invalidate: jest.fn(),
};

describe("StudentSyncService.syncProfile", () => {
  beforeEach(() => {
    (parseStudentInfo as jest.Mock).mockReturnValue(INFO);
  });

  it("fills the placeholder name from the DLU profile", async () => {
    const { prisma, service } = await setup();

    await service.syncProfile(DATA);

    expect(prisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "u1", name: DEFAULT_USER_NAME },
      data: { name: "Nguyễn Văn An" },
    });
  });
});

describe("StudentSyncService.dueForMarks", () => {
  const NOW = new Date("2026-11-20T03:00:00.000Z"); // HK01 2026-2027
  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;

  async function marksService(
    profiles: { userId: string; marksFetchedAt: Date | null }[],
    exams: { userId: string; start: Date }[],
    env: Record<string, unknown> = {},
  ) {
    const prisma = {
      studentProfile: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            profiles.map((p) => ({ ...p, integrationId: `i-${p.userId}` })),
          ),
      },
      session: {
        findMany: jest.fn().mockResolvedValue(
          exams.map((e) => ({
            userId: e.userId,
            scheduledStartTime: e.start,
            durationMinutes: 90,
          })),
        ),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        StudentSyncService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: { get: (key: string) => env[key] },
        },
        { provide: PortalAPIService, useValue: {} },
        { provide: PortalSessionService, useValue: {} },
        { provide: QueueService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();
    return module.get(StudentSyncService);
  }

  it("always includes a student whose marks were never fetched", async () => {
    const service = await marksService(
      [{ userId: "u1", marksFetchedAt: null }],
      [],
    );
    expect(await service.dueForMarks(NOW, 5)).toEqual([
      { userId: "u1", integrationId: "i-u1" },
    ]);
  });

  it("waits a week after the first exam ends before refetching", async () => {
    const stale = new Date(NOW.getTime() - 2 * HOUR);
    const early = await marksService(
      [{ userId: "u1", marksFetchedAt: stale }],
      [{ userId: "u1", start: new Date(NOW.getTime() - 3 * DAY) }],
    );
    expect(await early.dueForMarks(NOW, 5)).toEqual([]);

    const later = await marksService(
      [{ userId: "u1", marksFetchedAt: stale }],
      [{ userId: "u1", start: new Date(NOW.getTime() - 8 * DAY) }],
    );
    expect(await later.dueForMarks(NOW, 5)).toHaveLength(1);
  });

  it("ignores a student with no exam, however stale the marks", async () => {
    const service = await marksService(
      [{ userId: "u1", marksFetchedAt: new Date(NOW.getTime() - 5 * DAY) }],
      [],
    );
    expect(await service.dueForMarks(NOW, 5)).toEqual([]);
  });

  it("honours the wait override", async () => {
    const service = await marksService(
      [{ userId: "u1", marksFetchedAt: new Date(NOW.getTime() - 2 * HOUR) }],
      [{ userId: "u1", start: new Date(NOW.getTime() - 3 * HOUR) }],
      { INGESTION_MARKS_AFTER_EXAMS_MS: 0 },
    );
    expect(await service.dueForMarks(NOW, 5)).toHaveLength(1);
  });
});

describe("StudentSyncService.syncMarks", () => {
  const mark = (id: string, over: Record<string, unknown> = {}) => ({
    scheduleStudyUnitId: id,
    yearStudy: "2026-2027",
    termId: "1",
    curriculumId: null,
    curriculumName: `Course ${id}`,
    credits: 3,
    score10: 8,
    score4: 3.5,
    letter: "B+",
    passed: true,
    note: null,
    ...over,
  });

  async function marksSetup(
    stored: ReturnType<typeof mark>[],
    fetched: ReturnType<typeof mark>[],
    firstFetch = false,
  ) {
    const create = jest.fn().mockResolvedValue({ id: "n1" });
    const notify = jest.fn();
    const prisma = {
      studyProgram: {
        findMany: jest.fn().mockResolvedValue([{ studyProgramId: "p1" }]),
      },
      studentMark: {
        findMany: jest.fn().mockResolvedValue(stored),
        upsert: jest.fn().mockResolvedValue({}),
      },
      studentTermResult: { upsert: jest.fn() },
      studentProfile: {
        findUnique: jest.fn().mockResolvedValue({
          marksFetchedAt: firstFetch ? null : new Date(),
        }),
        updateMany: jest.fn(),
      },
    };
    (parseMarks as jest.Mock).mockReturnValue({
      marks: fetched,
      terms: [],
      studentId: null,
      faculty: null,
      major: null,
      ranking: null,
      gpa4: null,
      gpa10: null,
      creditsEarned: null,
    });
    const module = await Test.createTestingModule({
      providers: [
        StudentSyncService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: () => 0 } },
        {
          provide: PortalAPIService,
          useValue: { fetchMarks: jest.fn().mockResolvedValue([]) },
        },
        {
          provide: PortalSessionService,
          useValue: {
            withToken: (_u: string, use: (t: string) => Promise<unknown>) =>
              use("token").then((value) => ({ ok: true, value })),
          },
        },
        { provide: QueueService, useValue: {} },
        { provide: NotificationsService, useValue: { create, notify } },
      ],
    }).compile();
    await module.get(StudentSyncService).syncMarks(DATA);
    return { create, notify };
  }

  it("notifies a mark that is new", async () => {
    const { create, notify } = await marksSetup([], [mark("a")]);

    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        eventName: "marks.updated",
        title: "New mark: Course a",
      }),
    );
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies once for several changed marks", async () => {
    const { create } = await marksSetup(
      [mark("a", { score10: 5 })],
      [mark("a"), mark("b")],
    );

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ title: "2 new marks" }),
    );
  });

  it("stays quiet for unchanged marks and courses with no result", async () => {
    const { create } = await marksSetup(
      [mark("a")],
      [mark("a"), mark("b", { score10: null, letter: null })],
    );

    expect(create).not.toHaveBeenCalled();
  });

  it("announces marks.ready alone on the first fetch", async () => {
    const { create } = await marksSetup([], [mark("a")], true);

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ eventName: "marks.ready" }),
    );
  });
});
