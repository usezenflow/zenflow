import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { type User } from "../../generated/prisma";
import { AllowApiToken, ApiTokenOnly } from "./allow-api-token.decorator";
import { ApiTokenGuard } from "./api-token.guard";
import { OAuthConfig } from "../oauth/oauth.config";
import { ApiTokensService } from "./api-tokens.service";

/** A controller with one route per access mode, so the guard reads real metadata. */
class Probe {
  @AllowApiToken()
  allowed(this: void): void {}

  @ApiTokenOnly()
  bearerOnly(this: void): void {}

  denied(this: void): void {}
}

interface FakeRequest {
  headers: { authorization?: string };
  isAuthenticated: () => boolean;
  user?: unknown;
}

function request(
  headers: FakeRequest["headers"],
  session: { authenticated: boolean; email?: string },
): FakeRequest {
  return {
    headers,
    isAuthenticated: () => session.authenticated,
    user: session.email ? { email: session.email } : undefined,
  };
}

function context(
  handler: () => void,
  req: FakeRequest,
  res: { setHeader: jest.Mock } = { setHeader: jest.fn() },
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    getHandler: () => handler,
    getClass: () => Probe,
  } as unknown as ExecutionContext;
}

const NO_SESSION = { authenticated: false };
const SIGNED_IN = { authenticated: true, email: "alice@example.com" };
const alice = { id: "u-alice", email: "alice@example.com" } as unknown as User;

describe("ApiTokenGuard", () => {
  const originalDomains = process.env.ALLOWED_EMAIL_DOMAINS;
  afterEach(() => {
    if (originalDomains === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = originalDomains;
  });

  const MCP = new URL("https://api.example.com/api/v1/mcp");

  async function make(authenticate: jest.Mock, oauthAvailable = false) {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiTokenGuard,
        { provide: ApiTokensService, useValue: { authenticate } },
        {
          provide: OAuthConfig,
          useValue: { available: oauthAvailable, mcpUrl: MCP },
        },
      ],
    }).compile();
    return module.get(ApiTokenGuard);
  }

  it("accepts a live bearer token on an allowed route and sets the user", async () => {
    const authenticate = jest.fn().mockResolvedValue(alice);
    const guard = await make(authenticate);
    const req = request({ authorization: "Bearer zf_abc" }, NO_SESSION);

    await expect(
      guard.canActivate(context(Probe.prototype.allowed, req)),
    ).resolves.toBe(true);

    expect(authenticate).toHaveBeenCalledWith("zf_abc");
    expect(req.user).toBe(alice);
  });

  it("refuses a bearer token on a route without the decorator, before any lookup", async () => {
    const authenticate = jest.fn();
    const guard = await make(authenticate);
    const req = request({ authorization: "Bearer zf_abc" }, NO_SESSION);

    await expect(
      guard.canActivate(context(Probe.prototype.denied, req)),
    ).rejects.toThrow(ForbiddenException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers 401 for a token the service does not accept (unknown, revoked or wrong pepper)", async () => {
    const guard = await make(jest.fn().mockResolvedValue(null));
    const req = request({ authorization: "Bearer zf_revoked" }, NO_SESSION);

    await expect(
      guard.canActivate(context(Probe.prototype.allowed, req)),
    ).rejects.toThrow(UnauthorizedException);
    expect(req.user).toBeUndefined();
  });

  it("answers 401 when the token's owner is outside the allowed email domains", async () => {
    process.env.ALLOWED_EMAIL_DOMAINS = "dlu.edu.vn";
    const guard = await make(jest.fn().mockResolvedValue(alice));
    const req = request({ authorization: "Bearer zf_abc" }, NO_SESSION);

    await expect(
      guard.canActivate(context(Probe.prototype.allowed, req)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("refuses a cookie-less request on a bearer-only route", async () => {
    const guard = await make(jest.fn());
    const req = request({}, SIGNED_IN);

    await expect(
      guard.canActivate(context(Probe.prototype.bearerOnly, req)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("accepts a bearer token on a bearer-only route", async () => {
    const guard = await make(jest.fn().mockResolvedValue(alice));
    const req = request({ authorization: "Bearer zf_abc" }, NO_SESSION);

    await expect(
      guard.canActivate(context(Probe.prototype.bearerOnly, req)),
    ).resolves.toBe(true);
  });

  it("keeps cookie sessions working on any route", async () => {
    const authenticate = jest.fn();
    const guard = await make(authenticate);

    await expect(
      guard.canActivate(
        context(Probe.prototype.denied, request({}, SIGNED_IN)),
      ),
    ).resolves.toBe(true);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("answers 401 with neither a cookie session nor a bearer token", async () => {
    const guard = await make(jest.fn());

    await expect(
      guard.canActivate(
        context(Probe.prototype.allowed, request({}, NO_SESSION)),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it("points an OAuth client at the resource metadata when the bearer is missing or refused", async () => {
    const guard = await make(jest.fn().mockResolvedValue(null), true);
    const expected =
      'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/api/v1/mcp"';

    const missing = { setHeader: jest.fn() };
    await expect(
      guard.canActivate(
        context(Probe.prototype.bearerOnly, request({}, NO_SESSION), missing),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(missing.setHeader).toHaveBeenCalledWith(
      "WWW-Authenticate",
      expected,
    );

    const refused = { setHeader: jest.fn() };
    await expect(
      guard.canActivate(
        context(
          Probe.prototype.bearerOnly,
          request({ authorization: "Bearer zo_bad" }, NO_SESSION),
          refused,
        ),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(refused.setHeader).toHaveBeenCalledWith(
      "WWW-Authenticate",
      expected,
    );
  });

  it("sends no challenge when OAuth is not configured", async () => {
    const guard = await make(jest.fn().mockResolvedValue(null), false);
    const res = { setHeader: jest.fn() };

    await expect(
      guard.canActivate(
        context(Probe.prototype.bearerOnly, request({}, NO_SESSION), res),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(res.setHeader).not.toHaveBeenCalled();
  });
});
