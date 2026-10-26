import { Test, TestingModule } from "@nestjs/testing";
import { ActiveUsersService } from "../observability/active-users.service";
import { EngagementService } from "./engagement.service";

const NOW = new Date("2026-10-20T10:00:00.000Z");

describe("EngagementService", () => {
  const activeUsers = {
    dailyCounts: jest.fn(),
    weeklyCount: jest.fn(),
  };
  let service: EngagementService;

  beforeEach(async () => {
    jest.clearAllMocks();
    activeUsers.dailyCounts.mockResolvedValue([
      { day: "2026-10-19", dau: 4 },
      { day: "2026-10-20", dau: 7 },
    ]);
    activeUsers.weeklyCount.mockResolvedValue(9);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EngagementService,
        { provide: ActiveUsersService, useValue: activeUsers },
      ],
    }).compile();
    service = module.get(EngagementService);
  });

  it("takes DAU from today and WAU from the seven-day union", async () => {
    const result = await service.engagement(NOW);

    expect(result).toEqual({
      dau: 7,
      wau: 9,
      activeDays: [
        { day: "2026-10-19", dau: 4 },
        { day: "2026-10-20", dau: 7 },
      ],
    });
  });
});
