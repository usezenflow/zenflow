import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { DEFAULT_USER_NAME } from "@zenflow/shared";
import { NotificationsService } from "../notifications/notifications.service";
import { PortalAPIService } from "../portal/portal-api.service";
import { PrismaService } from "../prisma/prisma.service";
import { QueueService } from "../queue/queue.service";
import { parseStudentInfo } from "./core/parse-student";
import { PortalSessionService } from "./portal-session.service";
import { StudentSyncService } from "./student-sync.service";
import { UpstreamSessionCache } from "../integrations/upstream-session-cache.service";

jest.mock("./core/parse-student", () => ({
  ...jest.requireActual<Record<string, unknown>>("./core/parse-student"),
  parseStudentInfo: jest.fn(),
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
