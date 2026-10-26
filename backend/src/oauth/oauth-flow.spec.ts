import { createHash, randomBytes } from "crypto";
import express from "express";
import request from "supertest";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { OAuthConsentService } from "./oauth-consent.service";
import { fakeOAuthPrisma } from "./fake-oauth-prisma";
import { MCP_SCOPE, OAuthConfig } from "./oauth.config";
import { OAuthProvider } from "./oauth.provider";

interface Tokens {
  access_token: string;
  refresh_token: string;
}

const REDIRECT = "https://chatgpt.com/connector/callback";
const verifier = randomBytes(32).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

const user = { id: "user-1" } as never;
const other = { id: "user-2" } as never;

async function setup() {
  const fake = fakeOAuthPrisma();
  const config = {
    pepper: "p".repeat(40),
    peppers: ["p".repeat(40)],
    signingSecret: "s".repeat(40),
    connectUrl: "https://api.example.com/api/v1/oauth/connect",
    issuer: new URL("https://api.example.com"),
    mcpUrl: new URL("https://api.example.com/api/v1/mcp"),
  };
  const module = await Test.createTestingModule({
    providers: [
      OAuthProvider,
      OAuthConsentService,
      { provide: PrismaService, useValue: fake.prisma },
      { provide: OAuthConfig, useValue: config },
    ],
  }).compile();
  const provider = module.get(OAuthProvider);
  const app = express();
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: config.issuer,
      resourceServerUrl: config.mcpUrl,
      scopesSupported: [MCP_SCOPE],
      clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    }),
  );
  return { app, fake, consent: module.get(OAuthConsentService) };
}

async function register(app: express.Express) {
  const res = await request(app)
    .post("/register")
    .send({
      client_name: "ChatGPT",
      redirect_uris: [REDIRECT],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    })
    .expect(201);
  return (res.body as { client_id: string }).client_id;
}

async function authorize(
  app: express.Express,
  fake: ReturnType<typeof fakeOAuthPrisma>,
  clientId: string,
) {
  const res = await request(app)
    .get("/authorize")
    .query({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "xyz",
      scope: MCP_SCOPE,
    })
    .expect(302);
  const location = new URL(res.header.location);
  expect(location.origin + location.pathname).toBe(
    "https://api.example.com/api/v1/oauth/connect",
  );
  const requestToken = location.searchParams.get("request")!;
  const code = [...fake.consents.values()].at(-1)!.userCode;
  return { requestToken, code };
}

/** Approves or refuses, then reads the redirect the browser page is handed. */
async function decideAndRedirect(
  consent: OAuthConsentService,
  user: never,
  flow: { requestToken: string; code: string },
  approve: boolean,
) {
  await consent.decide(user, flow.code, approve);
  const polled = await consent.poll(flow.requestToken);
  if (polled.status !== "done") throw new Error("no redirect");
  return new URL(polled.redirectUrl);
}

describe("MCP OAuth flow", () => {
  it("publishes discovery metadata at the API origin", async () => {
    const { app } = await setup();

    const as = await request(app)
      .get("/.well-known/oauth-authorization-server")
      .expect(200);
    expect(as.body).toMatchObject({
      issuer: "https://api.example.com/",
      authorization_endpoint: "https://api.example.com/authorize",
      token_endpoint: "https://api.example.com/token",
      registration_endpoint: "https://api.example.com/register",
      code_challenge_methods_supported: ["S256"],
    });
    const rs = await request(app)
      .get("/.well-known/oauth-protected-resource/api/v1/mcp")
      .expect(200);
    expect(rs.body).toMatchObject({
      resource: "https://api.example.com/api/v1/mcp",
      authorization_servers: ["https://api.example.com/"],
    });
  });

  it("runs register, authorize, consent, token and refresh", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);

    const flow = await authorize(app, fake, clientId);
    expect(await consent.waiting(flow.requestToken)).toEqual({
      code: flow.code,
      clientName: "ChatGPT",
    });
    expect(await consent.poll(flow.requestToken)).toEqual({
      status: "pending",
    });
    expect(await consent.describe(user, flow.code.toLowerCase())).toEqual({
      clientName: "ChatGPT",
      redirectHost: "chatgpt.com",
      scopes: [MCP_SCOPE],
    });

    expect(await consent.decide(user, flow.code, true)).toEqual({
      approved: true,
    });
    const polled = await consent.poll(flow.requestToken);
    if (polled.status !== "done") throw new Error("no redirect");
    const back = new URL(polled.redirectUrl);
    expect(back.origin + back.pathname).toBe(REDIRECT);
    expect(back.searchParams.get("state")).toBe("xyz");
    const code = back.searchParams.get("code")!;

    const token = await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
      })
      .expect(200);
    expect(token.body).toMatchObject({
      token_type: "Bearer",
      scope: MCP_SCOPE,
    });

    const refreshed = await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "refresh_token",
        client_id: clientId,
        refresh_token: (token.body as Tokens).refresh_token,
      })
      .expect(200);
    expect((refreshed.body as Tokens).access_token).not.toBe(
      (token.body as Tokens).access_token,
    );
  });

  it("refuses a wrong PKCE verifier", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const back = await decideAndRedirect(
      consent,
      user,
      await authorize(app, fake, clientId),
      true,
    );
    const code = back.searchParams.get("code")!;

    const res = await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: randomBytes(32).toString("base64url"),
        redirect_uri: REDIRECT,
      })
      .expect(400);
    expect((res.body as { error: string }).error).toBe("invalid_grant");
  });

  it("sends the browser back with access_denied when the user refuses", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);

    const back = await decideAndRedirect(
      consent,
      user,
      await authorize(app, fake, clientId),
      false,
    );

    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("code")).toBeNull();
    expect(back.searchParams.get("state")).toBe("xyz");
  });

  it("rejects an unregistered redirect URI and a plain-http client", async () => {
    const { app } = await setup();
    const clientId = await register(app);

    await request(app)
      .get("/authorize")
      .query({
        response_type: "code",
        client_id: clientId,
        redirect_uri: "https://evil.example/cb",
        code_challenge: challenge,
        code_challenge_method: "S256",
      })
      .expect(400);
    await request(app)
      .post("/register")
      .send({
        client_name: "Bad",
        redirect_uris: ["http://evil.example/cb"],
        token_endpoint_auth_method: "none",
      })
      .expect(400);
  });

  it("rejects an expired or forged consent request", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const flow = await authorize(app, fake, clientId);

    await expect(consent.describe(user, "ABCD2345")).rejects.toThrow(
      /Check the code/,
    );
    await expect(consent.decide(user, "nonsense", true)).rejects.toThrow(
      /Check the code/,
    );
    expect(await consent.waiting("forged.token")).toBeNull();
    expect(await consent.poll("forged.token")).toEqual({ status: "expired" });
    fake.consents.get([...fake.consents.keys()].at(-1)!)!.expiresAt = new Date(
      0,
    );
    expect(await consent.poll(flow.requestToken)).toEqual({
      status: "expired",
    });
    await expect(consent.describe(user, flow.code)).rejects.toThrow(/expired/);
  });

  it("spends a consent request once", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const flow = await authorize(app, fake, clientId);

    await consent.decide(user, flow.code, true);
    await expect(consent.decide(user, flow.code, true)).rejects.toThrow(
      /expired/,
    );
  });

  it("finishes a consent request only for the user who opened it", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const flow = await authorize(app, fake, clientId);

    await consent.describe(user, flow.code);
    await expect(consent.decide(other, flow.code, true)).rejects.toThrow(
      /expired/,
    );
    await expect(consent.describe(other, flow.code)).rejects.toThrow(/expired/);
  });

  it("refuses a redirect the client no longer registers", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const flow = await authorize(app, fake, clientId);
    fake.clients.get(clientId)!.metadata = { redirect_uris: [] };

    await expect(consent.decide(user, flow.code, true)).rejects.toThrow(
      /cannot redirect/,
    );
  });

  it("only issues tokens for the MCP endpoint", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const back = await decideAndRedirect(
      consent,
      user,
      await authorize(app, fake, clientId),
      true,
    );
    const code = back.searchParams.get("code")!;

    await request(app)
      .post("/token")
      .type("form")
      .send({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: verifier,
        redirect_uri: REDIRECT,
        resource: "https://evil.example/mcp",
      })
      .expect(400);
  });

  it("sends the browser back with invalid_target for another resource", async () => {
    const { app } = await setup();
    const clientId = await register(app);

    const res = await request(app)
      .get("/authorize")
      .query({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "https://evil.example/mcp",
      })
      .expect(302);
    expect(new URL(res.header.location).searchParams.get("error")).toBe(
      "invalid_target",
    );
  });

  it("rejects a redirect URI with a fragment", async () => {
    const { app } = await setup();
    await request(app)
      .post("/register")
      .send({
        client_name: "Fragment",
        redirect_uris: ["https://chatgpt.com/cb#x"],
        token_endpoint_auth_method: "none",
      })
      .expect(400);
  });

  it("hands the redirect to the browser page once", async () => {
    const { app, fake, consent } = await setup();
    const clientId = await register(app);
    const flow = await authorize(app, fake, clientId);

    await consent.decide(user, flow.code, true);

    const first = await consent.poll(flow.requestToken);
    expect(first.status).toBe("done");
    expect(await consent.poll(flow.requestToken)).toEqual({
      status: "pending",
    });
    expect([...fake.consents.values()].at(-1)!.redirectUrl).toBeNull();
  });
});
