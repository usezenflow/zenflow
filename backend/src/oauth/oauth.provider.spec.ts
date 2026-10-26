import { Test } from "@nestjs/testing";
import { PrismaService } from "../prisma/prisma.service";
import { fakeOAuthPrisma } from "./fake-oauth-prisma";
import { OAuthConfig } from "./oauth.config";
import { OAuthProvider } from "./oauth.provider";

const client = (id = "client-1") =>
  ({ client_id: id, redirect_uris: ["https://chatgpt.com/cb"] }) as never;
const request = (over: Record<string, unknown> = {}) => ({
  clientId: "client-1",
  redirectUri: "https://chatgpt.com/cb",
  codeChallenge: "challenge",
  scopes: ["schedule"],
  resource: "https://api.example.com/api/v1/mcp",
  ...over,
});

async function setup() {
  const fake = fakeOAuthPrisma();
  fake.clients.set("client-1", {
    id: "client-1",
    name: "ChatGPT",
    metadata: {},
  });
  fake.clients.set("client-2", { id: "client-2", name: "Other", metadata: {} });
  const module = await Test.createTestingModule({
    providers: [
      OAuthProvider,
      { provide: PrismaService, useValue: fake.prisma },
      {
        provide: OAuthConfig,
        useValue: {
          pepper: "p".repeat(40),
          peppers: ["p".repeat(40)],
          signingSecret: "s",
          connectUrl: "https://api/oauth/connect",
          mcpUrl: new URL("https://api.example.com/api/v1/mcp"),
        },
      },
    ],
  }).compile();
  return { provider: module.get(OAuthProvider), fake };
}

describe("OAuthProvider", () => {
  it("never stores a secret, only its hash", async () => {
    const { provider, fake } = await setup();
    const code = await provider.issueCode("user-1", request());
    const tokens = await provider.exchangeAuthorizationCode(
      client(),
      code,
      "v",
      "https://chatgpt.com/cb",
    );

    const stored = JSON.stringify(fake.tokens());
    for (const secret of [code, tokens.access_token, tokens.refresh_token!])
      expect(stored).not.toContain(secret);
  });

  it("exchanges a code for tokens that authenticate the user", async () => {
    const { provider } = await setup();
    const code = await provider.issueCode("user-1", request());

    expect(await provider.challengeForAuthorizationCode(client(), code)).toBe(
      "challenge",
    );
    const tokens = await provider.exchangeAuthorizationCode(
      client(),
      code,
      "v",
      "https://chatgpt.com/cb",
    );

    expect(tokens).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "schedule",
    });
    const info = await provider.verifyAccessToken(tokens.access_token);
    expect(info).toMatchObject({
      clientId: "client-1",
      scopes: ["schedule"],
      extra: { userId: "user-1" },
    });
  });

  it("rejects a code from another client or for another redirect", async () => {
    const { provider } = await setup();
    const code = await provider.issueCode("user-1", request());

    await expect(
      provider.exchangeAuthorizationCode(
        client("client-2"),
        code,
        "v",
        "https://chatgpt.com/cb",
      ),
    ).rejects.toThrow();
    await expect(
      provider.exchangeAuthorizationCode(
        client(),
        code,
        "v",
        "https://evil.example/cb",
      ),
    ).rejects.toThrow(/redirect_uri/);
  });

  it("revokes everything a replayed code produced", async () => {
    const { provider, fake } = await setup();
    const code = await provider.issueCode("user-1", request());
    const first = await provider.exchangeAuthorizationCode(
      client(),
      code,
      "v",
      "https://chatgpt.com/cb",
    );

    await expect(
      provider.exchangeAuthorizationCode(
        client(),
        code,
        "v",
        "https://chatgpt.com/cb",
      ),
    ).rejects.toThrow(/already used/);

    await expect(
      provider.verifyAccessToken(first.access_token),
    ).rejects.toThrow();
    expect(fake.tokens()).toHaveLength(0);
  });

  it("expires a code after five minutes", async () => {
    const { provider, fake } = await setup();
    const code = await provider.issueCode("user-1", request());
    fake.tokens()[0].expiresAt = new Date(Date.now() - 1);

    await expect(
      provider.exchangeAuthorizationCode(
        client(),
        code,
        "v",
        "https://chatgpt.com/cb",
      ),
    ).rejects.toThrow(/expired/);
  });

  it("rotates the refresh token and revokes the family when an old one returns", async () => {
    const { provider } = await setup();
    const code = await provider.issueCode("user-1", request());
    const first = await provider.exchangeAuthorizationCode(
      client(),
      code,
      "v",
      "https://chatgpt.com/cb",
    );

    const second = await provider.exchangeRefreshToken(
      client(),
      first.refresh_token!,
    );
    expect(second.refresh_token).not.toBe(first.refresh_token);
    expect(
      (await provider.verifyAccessToken(second.access_token)).extra,
    ).toEqual({ userId: "user-1" });

    await expect(
      provider.exchangeRefreshToken(client(), first.refresh_token!),
    ).rejects.toThrow(/already used/);
    await expect(
      provider.verifyAccessToken(second.access_token),
    ).rejects.toThrow();
    await expect(
      provider.exchangeRefreshToken(client(), second.refresh_token!),
    ).rejects.toThrow();
  });

  it("treats a token of the wrong kind as unknown", async () => {
    const { provider } = await setup();
    const code = await provider.issueCode("user-1", request());
    const tokens = await provider.exchangeAuthorizationCode(
      client(),
      code,
      "v",
      "https://chatgpt.com/cb",
    );

    await expect(
      provider.verifyAccessToken(tokens.refresh_token!),
    ).rejects.toThrow();
    await expect(
      provider.exchangeRefreshToken(client(), tokens.access_token),
    ).rejects.toThrow();
  });

  it("revokes a family when the client asks", async () => {
    const { provider } = await setup();
    const code = await provider.issueCode("user-1", request());
    const tokens = await provider.exchangeAuthorizationCode(
      client(),
      code,
      "v",
      "https://chatgpt.com/cb",
    );

    await provider.revokeToken(client(), { token: tokens.refresh_token! });

    await expect(
      provider.verifyAccessToken(tokens.access_token),
    ).rejects.toThrow();
  });

  it("only registers https or loopback redirect URIs", async () => {
    const { provider } = await setup();
    const register = (uri: string) =>
      provider.clientsStore.registerClient!({
        client_id: "new",
        client_name: "App",
        redirect_uris: [uri],
      } as never);

    await expect(register("https://chatgpt.com/cb")).resolves.toBeDefined();
    await expect(
      register("http://localhost:3118/callback"),
    ).resolves.toBeDefined();
    await expect(register("http://evil.example/cb")).rejects.toThrow(/https/);
  });
});
