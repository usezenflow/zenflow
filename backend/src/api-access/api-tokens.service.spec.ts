import { ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import type { User } from "../../generated/prisma";
import { PrismaService } from "../prisma/prisma.service";
import { ApiTokensService } from "./api-tokens.service";
import { hashApiToken } from "./api-token.util";

const PEPPER = "pepper-one-that-is-long-enough-1234";
const OTHER_PEPPER = "pepper-two-that-is-long-enough-1234";
const T0 = new Date("2026-10-26T00:00:00Z");
const alice = { id: "u-alice", email: "alice@example.com" } as unknown as User;

async function make(vars: Record<string, string | undefined>, stored?: string) {
  const findFirst = jest.fn(
    (args: { where: { hash: { in: string[] }; expiresAt: { gt: Date } } }) =>
      Promise.resolve(
        stored &&
          args.where.hash.in.includes(hashApiToken(stored, PEPPER)) &&
          T0.getTime() + 60_000 > args.where.expiresAt.gt.getTime()
          ? { user: alice }
          : null,
      ),
  );
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ApiTokensService,
      { provide: PrismaService, useValue: { oAuthToken: { findFirst } } },
      { provide: ConfigService, useValue: { get: (k: string) => vars[k] } },
    ],
  }).compile();
  return { service: module.get(ApiTokensService), findFirst };
}

describe("ApiTokensService", () => {
  it("authenticates a live access token to its owner", async () => {
    const { service } = await make({ API_TOKEN_PEPPER_V1: PEPPER }, "zo_live");
    expect((await service.authenticate("zo_live", T0))?.id).toBe("u-alice");
  });

  it("refuses an expired, unknown or foreign-prefix secret", async () => {
    const { service, findFirst } = await make(
      { API_TOKEN_PEPPER_V1: PEPPER },
      "zo_live",
    );
    expect(
      await service.authenticate("zo_live", new Date(T0.getTime() + 120_000)),
    ).toBeNull();
    expect(await service.authenticate("zo_other", T0)).toBeNull();
    expect(await service.authenticate("zf_old", T0)).toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it("authenticates nothing without a pepper", async () => {
    const { service, findFirst } = await make({}, "zo_live");
    expect(await service.authenticate("zo_live", T0)).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("keeps tokens minted under an older pepper valid after rotation", async () => {
    const { service } = await make(
      {
        API_TOKEN_PEPPER_CURRENT_VERSION: "2",
        API_TOKEN_PEPPER_V1: PEPPER,
        API_TOKEN_PEPPER_V2: OTHER_PEPPER,
      },
      "zo_live",
    );
    expect((await service.authenticate("zo_live", T0))?.id).toBe("u-alice");
  });
});
