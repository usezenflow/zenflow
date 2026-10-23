import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { Test, TestingModule } from "@nestjs/testing";
import type { PlaceContractFixture, PlacedMember } from "@zenflow/shared";
import type { User } from "../../../generated/prisma";
import { PrismaService } from "../../prisma/prisma.service";
import { BanditArmStateRepository } from "../../bandit/bandit-arm-state.repository";
import { FallbackPlacer } from "./fallback-placer.service";
import { HeuristicPlacer } from "./heuristic-placer.service";
import { PlacementClient } from "./placement-client.service";
import { PlacementGateway } from "./placement-gateway.service";

/**
 * Contract fixtures (`packages/shared/contract/place/*.json`, ADR-0003 section
 * 5). The Python side asserts `/v1/place(request) == response`; here Nest
 * asserts (a) the frozen TS heuristic agrees with every fixture's heuristic
 * pick (which is the hand-check evidence for the fixtures themselves) and (b)
 * `PlacementGateway.buildRequest` produces the fixture's request for the
 * equivalent seeded calendar.
 */
const DIR = join(__dirname, "../../../../packages/shared/contract/place");
const fixtures: PlaceContractFixture[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map(
    (f) =>
      JSON.parse(readFileSync(join(DIR, f), "utf8")) as PlaceContractFixture,
  );

function prismaFor(f: PlaceContractFixture) {
  const rows = f.request.days
    .flatMap((d) => d.occupied)
    .map((o, i) => ({
      id: `occ-${i}`,
      type: "DND",
      seriesId: null,
      scheduledStartTime: new Date(o.startMs),
      durationMinutes: (o.endMs - o.startMs) / 60_000,
      deadline: null,
    }));
  return {
    session: { findMany: jest.fn().mockResolvedValue(rows) },
    sessionSeries: { findMany: jest.fn().mockResolvedValue([]) },
    sessionEvent: { count: jest.fn().mockResolvedValue(0) },
  };
}

const userOf = (f: PlaceContractFixture) =>
  ({
    id: "u1",
    timezone: f.request.timezone,
    preferenceMatrix: f.request.user.preferenceMatrix,
  }) as unknown as User;

describe("placement contract fixtures", () => {
  it("has the hand-checked fixture set", () => {
    expect(fixtures.map((f) => f.name).sort()).toEqual(
      expect.arrayContaining([
        "single-heuristic-placed",
        "single-infeasible-second-call",
        "single-needs-infeasible-context",
      ]),
    );
  });

  it.each(fixtures.map((f) => [f.name, f] as const))(
    "%s: response carries the request's task",
    (_name, f) => {
      expect(f.response.result.id).toBe(f.request.member.id);
      expect(f.response.contractVersion).toBe(f.request.contractVersion);
    },
  );

  it.each(
    fixtures
      .filter(
        (f) =>
          !f.request.infeasible &&
          f.request.member.primaryPolicy === "HEURISTIC",
      )
      .map((f) => [f.name, f] as const),
  )(
    "%s: frozen TS heuristic agrees with the fixture picks",
    async (_name, f) => {
      const prisma = prismaFor(f);
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          HeuristicPlacer,
          FallbackPlacer,
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();
      const fallback = module.get<FallbackPlacer>(FallbackPlacer);
      const user = userOf(f);
      const now = new Date(f.request.nowMs);
      const deadline = new Date(f.request.deadlineMs);
      const want: PlacedMember = f.response.result;
      const start = await fallback.placeSingle(
        user.id,
        {
          id: f.request.member.id,
          durationMinutes: f.request.member.durationMinutes,
          deadline,
        },
        user.timezone,
        user.preferenceMatrix,
        now,
      );
      const wantMs =
        want.outcome === "PLACED" ? (want.heuristic?.startMs ?? null) : null;
      expect(start?.getTime() ?? null).toBe(wantMs);
    },
  );

  it("single-heuristic-placed: gateway builds exactly the fixture request", async () => {
    const f = fixtures.find((x) => x.name === "single-heuristic-placed");
    if (!f) throw new Error("fixture missing");
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlacementGateway,
        { provide: PrismaService, useValue: prismaFor(f) },
        { provide: PlacementClient, useValue: {} },
        {
          provide: BanditArmStateRepository,
          useValue: { loadAll: jest.fn() },
        },
      ],
    }).compile();
    const gateway = module.get<PlacementGateway>(PlacementGateway);
    const built = await gateway.buildRequest({
      user: userOf(f),
      member: f.request.member,
      deadline: new Date(f.request.deadlineMs),
      now: new Date(f.request.nowMs),
      mode: "PLACE",
      maxScanDays: f.request.maxScanDays,
      excludeSessionIds: [],
    });
    expect({ ...built, requestId: "x" }).toEqual({
      ...f.request,
      requestId: "x",
    });
  });
});
