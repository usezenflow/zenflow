import { Injectable } from "@nestjs/common";
import { createHmac, timingSafeEqual } from "crypto";
import { GoogleApiError } from "./google-calendar.client";
import {
  GOOGLE_CALENDAR_SCOPE,
  GoogleCalendarConfig,
} from "./google-calendar.config";
import { openToken, sealToken } from "./token-box";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const STATE_TTL_MS = 10 * 60_000;
/** Refresh a little early so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

@Injectable()
export class GoogleOAuthService {
  private readonly cache = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly config: GoogleCalendarConfig) {}

  /** Signed, expiring state that carries the user id through the Google redirect. */
  signState(userId: string, now = Date.now()): string {
    const payload = Buffer.from(
      JSON.stringify({ u: userId, e: now + STATE_TTL_MS }),
    ).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  /** The user id inside a valid, unexpired state, else null. */
  verifyState(state: string, now = Date.now()): string | null {
    const [payload, sig] = state.split(".");
    if (!payload || !sig) return null;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given))
      return null;
    try {
      const { u, e } = JSON.parse(
        Buffer.from(payload, "base64url").toString(),
      ) as { u: string; e: number };
      return e > now ? u : null;
    } catch {
      return null;
    }
  }

  authUrl(userId: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPE,
      access_type: "offline",
      prompt: "consent",
      state: this.signState(userId),
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  /** Trades the one-time code for a refresh token. */
  async exchangeCode(
    code: string,
  ): Promise<{ refreshToken: string; accessToken: string; expiresIn: number }> {
    const res = await this.token({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.config.redirectUri,
    });
    if (!res.refresh_token) {
      throw new GoogleApiError(
        400,
        "no_refresh_token",
        "Google returned no refresh token",
      );
    }
    return {
      refreshToken: res.refresh_token,
      accessToken: res.access_token,
      expiresIn: res.expires_in,
    };
  }

  seal(refreshToken: string): string {
    const { current, values } = this.config.tokenKeys;
    return sealToken(refreshToken, {
      version: current,
      hex: values.get(current) ?? "",
    });
  }

  /** A valid access token for a stored (sealed) refresh token, cached until it nears expiry. */
  async accessToken(userId: string, sealedRefresh: string): Promise<string> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now() + EXPIRY_SKEW_MS)
      return cached.token;
    const res = await this.token({
      grant_type: "refresh_token",
      refresh_token: openToken(sealedRefresh, this.config.tokenKeys.values),
    });
    this.cache.set(userId, {
      token: res.access_token,
      expiresAt: Date.now() + res.expires_in * 1000,
    });
    return res.access_token;
  }

  forget(userId: string): void {
    this.cache.delete(userId);
  }

  async revoke(sealedRefresh: string): Promise<void> {
    try {
      await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: openToken(sealedRefresh, this.config.tokenKeys.values),
        }),
      });
    } catch {
      // Best effort: the user can also revoke in their Google account.
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.config.stateSecret)
      .update(payload)
      .digest("base64url");
  }

  private async token(form: Record<string, string>) {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...form,
      }),
    });
    const json = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok) {
      throw new GoogleApiError(
        res.status,
        json.error ?? "",
        json.error_description ?? "Google token request failed",
      );
    }
    return json;
  }
}
