import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PublicUrls } from "../common/config/public-urls";

export const MCP_SCOPE = "schedule";
export const CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TTL_MS = 60 * 60_000;
export const REFRESH_TTL_MS = 30 * 24 * 3_600_000;
export const CONSENT_TTL_MS = 10 * 60_000;
/** Client registrations allowed per hour, across all callers. */
export const CLIENT_REGISTRATION_LIMIT = 20;
/** A registered client with no tokens is dropped after this long. */
export const UNUSED_CLIENT_TTL_MS = 7 * 24 * 3_600_000;

@Injectable()
export class OAuthConfig {
  constructor(
    private readonly config: ConfigService,
    private readonly urls: PublicUrls,
  ) {}

  /** Secret that keys token hashes; shared with personal API tokens. */
  get pepper(): string {
    return this.config.get<string>("API_TOKEN_PEPPER") ?? "";
  }
  get signingSecret(): string {
    return this.config.get<string>("SESSION_SECRET") ?? "";
  }
  /** The API origin: discovery metadata lives at its well-known paths. */
  get issuer(): URL {
    return new URL(new URL(this.urls.api).origin);
  }
  /** The protected resource clients connect to. */
  get mcpUrl(): URL {
    return new URL(`${this.urls.api}/mcp`);
  }
  get consentUrl(): string {
    return `${this.urls.web}/oauth/consent`;
  }
  get available(): boolean {
    return !!(this.urls.api && this.pepper);
  }
}
