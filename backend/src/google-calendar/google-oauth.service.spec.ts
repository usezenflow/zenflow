import { Test } from "@nestjs/testing";
import { GoogleCalendarConfig } from "./google-calendar.config";
import { GoogleOAuthService } from "./google-oauth.service";

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  tokenKey: "a".repeat(64),
  stateSecret: "state-secret",
  redirectUri: "https://api.example.com/api/v1/google-calendar/callback",
};

async function service(over: Partial<typeof config> = {}) {
  const module = await Test.createTestingModule({
    providers: [
      GoogleOAuthService,
      { provide: GoogleCalendarConfig, useValue: { ...config, ...over } },
    ],
  }).compile();
  return module.get(GoogleOAuthService);
}

describe("GoogleOAuthService", () => {
  it("round-trips the user through the signed state", async () => {
    const oauth = await service();
    expect(oauth.verifyState(oauth.signState("user-1"))).toBe("user-1");
  });

  it("rejects an expired, forged or malformed state", async () => {
    const oauth = await service();
    const state = oauth.signState("user-1", 0);
    expect(oauth.verifyState(state, 11 * 60_000)).toBeNull();
    const [payload] = oauth.signState("user-1").split(".");
    expect(oauth.verifyState(`${payload}.forged`)).toBeNull();
    expect(oauth.verifyState("nonsense")).toBeNull();
    const other = await service({ stateSecret: "different" });
    expect(other.verifyState(oauth.signState("user-1"))).toBeNull();
  });

  it("builds a consent URL that asks for offline access to app-created calendars only", async () => {
    const oauth = await service();
    const url = new URL(oauth.authUrl("user-1"));
    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/calendar.app.created",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(oauth.verifyState(url.searchParams.get("state")!)).toBe("user-1");
  });

  it("caches an access token until it nears expiry", async () => {
    const oauth = await service();
    const fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({ access_token: "at-1", expires_in: 3600 }),
            { status: 200 },
          ),
        ),
      );
    const sealed = oauth.seal("refresh-token");

    expect(await oauth.accessToken("user-1", sealed)).toBe("at-1");
    expect(await oauth.accessToken("user-1", sealed)).toBe("at-1");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    oauth.forget("user-1");
    await oauth.accessToken("user-1", sealed);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it("reports a revoked grant", async () => {
    const oauth = await service();
    const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant" }), {
        status: 400,
      }),
    );

    await expect(
      oauth.accessToken("user-1", oauth.seal("revoked")),
    ).rejects.toMatchObject({ authRevoked: true });
    fetchMock.mockRestore();
  });
});
