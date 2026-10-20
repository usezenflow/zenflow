import { Test, TestingModule } from "@nestjs/testing";
import { ActiveUsersService } from "../observability/active-users.service";
import { PrismaService } from "../prisma/prisma.service";
import { EngagementService } from "./engagement.service";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

describe("EngagementService", () => {
  const prisma = { $queryRaw: jest.fn() };
  const activeUsers = {
    dailyCounts: jest.fn(),
    weeklyCount: jest.fn(),
  };
  let service: EngagementService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Route by SQL text: the three queries run in parallel.
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("WITH days")) {
        return Promise.resolve([{ length: 1 }, { length: 3 }, { length: 15 }]);
      }
      if (sql.includes('JOIN "ClientEvent"')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        { cohortWeek: new Date(NOW.getTime() - 2 * WEEK_MS), size: 10 },
      ]);
    });
    activeUsers.dailyCounts.mockResolvedValue([
      { day: "2026-10-19", dau: 4 },
      { day: "2026-10-20", dau: 7 },
    ]);
    activeUsers.weeklyCount.mockResolvedValue(9);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementService,
        { provide: PrismaService, useValue: prisma },
        { provide: ActiveUsersService, useValue: activeUsers },
      ],
    }).compile();
    service = module.get(EngagementService);
  });

  it("takes DAU from today and WAU from the seven-day union", async () => {
    const result = await service.engagement(NOW);

    expect(result.dau).toBe(7);
    expect(result.wau).toBe(9);
    expect(result.activeDays).toHaveLength(2);
  });

  it("buckets current streaks", async () => {
    const { streaks } = await service.engagement(NOW);

    expect(streaks).toEqual([
      { days: "1", users: 1 },
      { days: "2 to 3", users: 1 },
      { days: "4 to 6", users: 0 },
      { days: "7 to 13", users: 0 },
      { days: "14 or more", users: 1 },
    ]);
  });

  it("leaves weeks that have not ended as null", async () => {
    const { retention } = await service.engagement(NOW);
    const [cohort] = retention;

    expect(cohort.size).toBe(10);
    expect(cohort.weeks[0]).toBe(0);
    expect(cohort.weeks[1]).toBe(0);
    expect(cohort.weeks[2]).toBeNull();
  });
});
