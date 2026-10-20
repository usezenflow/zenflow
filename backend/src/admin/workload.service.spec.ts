import { Test, TestingModule } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { WorkloadService } from "./workload.service";

describe("WorkloadService", () => {
  const prisma = { $queryRaw: jest.fn() };
  let service: WorkloadService;

  beforeEach(async () => {
    prisma.$queryRaw.mockReset();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkloadService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get(WorkloadService);
  });

  it("drops groups under five students and never queries their sessions", async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([
        { value: "CTK47A", students: 5 },
        { value: "NNA46A", students: 4 },
      ])
      .mockResolvedValueOnce([]);
    // cohort and faculty dimensions have no profiles here
    prisma.$queryRaw.mockResolvedValue([]);

    const { groups } = await service.workload();

    expect(groups.map((g) => g.value)).toEqual(["CTK47A"]);
  });

  it("places minutes at [weekday][hour] of each group", async () => {
    prisma.$queryRaw.mockImplementation((strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("AS students")) {
        return Promise.resolve([{ value: "CTK47A", students: 6 }]);
      }
      return Promise.resolve([
        { value: "CTK47A", weekday: 2, hour: 9, minutes: 90 },
      ]);
    });

    const { groups } = await service.workload();
    const faculty = groups.find((g) => g.dimension === "className");

    expect(faculty?.minutes[2][9]).toBe(90);
    expect(faculty?.minutes[0][0]).toBe(0);
    expect(faculty?.minutes).toHaveLength(7);
    expect(faculty?.minutes[0]).toHaveLength(24);
  });
});
