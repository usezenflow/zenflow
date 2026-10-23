/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import {
  SCHEDULING_ARMS,
  type BanditArmStateWire,
  type SchedulingArm,
} from "@zenflow/shared";
import { BanditService } from "./bandit.service";

async function make(url: string | undefined) {
  const config = { get: jest.fn().mockReturnValue(url) };
  const module: TestingModule = await Test.createTestingModule({
    providers: [BanditService, { provide: ConfigService, useValue: config }],
  }).compile();
  return module.get<BanditService>(BanditService);
}

const COLD: BanditArmStateWire = { A: [], b: [] };
const ALL_COLD = Object.fromEntries(
  SCHEDULING_ARMS.map((arm) => [arm, COLD]),
) as Record<SchedulingArm, BanditArmStateWire>;

describe("BanditService", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.restoreAllMocks();
  });

  it("is disabled and returns null without calling fetch when no URL is set", async () => {
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as never;
    const svc = await make(undefined);

    expect(svc.enabled).toBe(false);
    expect(await svc.update("HOUR_09", [1], 1, ALL_COLD)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("update posts all 24 arms and the played hour to /v1/update", async () => {
    const reply = Object.fromEntries(
      SCHEDULING_ARMS.map((arm) => [arm, { A: [1], b: [2] }]),
    ) as Record<SchedulingArm, BanditArmStateWire>;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ arms: reply }),
    }) as never;
    const svc = await make("http://bandit:8100/");

    const out = await svc.update("HOUR_21", [0.1], -0.5, ALL_COLD);
    expect(out).toEqual({ arms: reply });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("http://bandit:8100/v1/update");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body);
    expect(body.ridge).toBeCloseTo(1);
    expect(body.arm).toBe("HOUR_21");
    expect(body.reward).toBeCloseTo(-0.5);
    expect(Object.keys(body.arms)).toHaveLength(24);
    expect(body.state).toBeUndefined();
  });

  it("returns null on a non-200", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as never;
    const svc = await make("http://bandit:8100");
    expect(await svc.update("HOUR_09", [1], 1, ALL_COLD)).toBeNull();
  });

  it("returns null when fetch throws (timeout / network)", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("The operation was aborted")) as never;
    const svc = await make("http://bandit:8100");
    expect(await svc.update("HOUR_09", [1], 1, ALL_COLD)).toBeNull();
  });
});
