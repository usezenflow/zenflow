import { Test, TestingModule } from "@nestjs/testing";
import type { Request } from "express";
import { type User } from "../../generated/prisma";
import { PublicUrls } from "../common/config/public-urls";
import { ApiAccessController } from "./api-access.controller";
import { ApiAccessService } from "./api-access.service";
import { ApiTokensService } from "./api-tokens.service";

const USER = { id: "u1", timezone: "UTC" } as unknown as User;

async function make(publicApi = "") {
  const summary = jest.fn().mockResolvedValue({ mcpUrl: "m" });
  const create = jest
    .fn()
    .mockResolvedValue({ token: { id: "t1" }, secret: "zf_once" });
  const revoke = jest.fn().mockResolvedValue({ revoked: true });
  const module: TestingModule = await Test.createTestingModule({
    controllers: [ApiAccessController],
    providers: [
      { provide: ApiAccessService, useValue: { summary } },
      { provide: ApiTokensService, useValue: { create, revoke } },
      { provide: PublicUrls, useValue: { api: publicApi } },
    ],
  }).compile();
  return {
    summary,
    create,
    revoke,
    controller: module.get(ApiAccessController),
  };
}

describe("ApiAccessController", () => {
  it("builds the REST base from the request origin", async () => {
    const { summary, controller } = await make();
    const req = {
      protocol: "https",
      get: () => "api.example.com",
    } as unknown as Request;

    const res = await controller.get(req, USER);

    expect(summary).toHaveBeenCalledWith(
      USER,
      "https://api.example.com/api/v1",
    );
    expect(res).toEqual({ success: true, data: { mcpUrl: "m" } });
  });

  it("prefers the configured public API URL", async () => {
    const { summary, controller } = await make(
      "https://api.usezenflow.com/api/v1",
    );
    const req = {
      protocol: "http",
      get: () => "internal:8000",
    } as unknown as Request;

    await controller.get(req, USER);

    expect(summary).toHaveBeenCalledWith(
      USER,
      "https://api.usezenflow.com/api/v1",
    );
  });

  it("returns the secret in the create response", async () => {
    const { create, controller } = await make();

    const res = await controller.create({ name: "ChatGPT" }, USER);

    expect(create).toHaveBeenCalledWith(USER, { name: "ChatGPT" });
    expect(res).toEqual({
      success: true,
      message: "API token created",
      data: { token: { id: "t1" }, secret: "zf_once" },
    });
  });

  it("revokes by id and wraps the envelope", async () => {
    const { revoke, controller } = await make();

    const res = await controller.revoke("t1", USER);

    expect(revoke).toHaveBeenCalledWith(USER, "t1");
    expect(res).toEqual({
      success: true,
      message: "API token revoked",
      data: { revoked: true },
    });
  });
});
