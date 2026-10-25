import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PublicUrls } from "../common/config/public-urls";

export const GOOGLE_CALENDAR_SCOPE =
  "https://www.googleapis.com/auth/calendar.app.created";

/** Env-driven settings. The feature is off until every required value is set. */
@Injectable()
export class GoogleCalendarConfig {
  constructor(
    private readonly config: ConfigService,
    private readonly urls: PublicUrls,
  ) {}

  get clientId(): string {
    return this.config.get<string>("GOOGLE_CLIENT_ID") ?? "";
  }
  get clientSecret(): string {
    return this.config.get<string>("GOOGLE_CLIENT_SECRET") ?? "";
  }
  get tokenKey(): string {
    return this.config.get<string>("GOOGLE_TOKEN_ENCRYPTION_KEY") ?? "";
  }
  get apiUrl(): string {
    return this.urls.api;
  }
  /** Where the user lands after connecting. */
  get webUrl(): string {
    return this.urls.web;
  }
  get redirectUri(): string {
    return `${this.apiUrl}/google-calendar/callback`;
  }
  get webhookUrl(): string {
    return `${this.apiUrl}/google-calendar/webhook`;
  }
  get stateSecret(): string {
    return this.config.get<string>("SESSION_SECRET") ?? "";
  }

  get available(): boolean {
    return !!(
      this.clientId &&
      this.clientSecret &&
      this.tokenKey &&
      this.apiUrl
    );
  }
}
