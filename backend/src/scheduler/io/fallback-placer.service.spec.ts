import { Test, TestingModule } from "@nestjs/testing";
import { FallbackPlacer } from "./fallback-placer.service";
import { HeuristicPlacer } from "./heuristic-placer.service";

const tz = "UTC";
const now = new Date("2026-06-08T08:00:00.000Z");
const deadline = new Date("2026-06-11T00:00:00.000Z");

async function make(placeInWindow: jest.Mock) {
  const heuristic = { placeTask: jest.fn(), placeInWindow };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      FallbackPlacer,
      { provide: HeuristicPlacer, useValue: heuristic },
    ],
  }).compile();
  return { fb: module.get<FallbackPlacer>(FallbackPlacer), heuristic };
}

describe("FallbackPlacer (frozen heuristic, ADR-0003)", () => {
  it("placeSingle delegates to the heuristic and never displaces or accepts conflicts", async () => {
    const { fb, heuristic } = await make(jest.fn());
    heuristic.placeTask.mockResolvedValue(null);
    const t = { id: "t", durationMinutes: 60, deadline };
    expect(await fb.placeSingle("u", t, tz, [], now)).toBeNull();
    expect(heuristic.placeTask).toHaveBeenCalledWith("u", t, tz, [], now);
  });
});
