import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PublicUrls } from "../common/config/public-urls";
import { readVersionedSecret } from "../common/config/versioned-secret";

/** Writes the Zenflow calendar and reads the user's other calendars for busy time (ADR-0040). */
export const GOOGLE_CALENDAR_SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
].join(" ");

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
  /** Keys that seal refresh tokens. Old versions still open existing rows. */
  get tokenKeys() {
    return readVersionedSecret(
      (key) => this.config.get<string>(key),
      "GOOGLE_TOKEN_ENCRYPTION_KEY",
    );
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
  /** Keys the push channel tokens. Its own secret, so a leak of the session secret cannot forge webhooks. */
  get webhookSecret(): string {
    return this.config.get<string>("GOOGLE_WEBHOOK_SECRET") ?? "";
  }

  get available(): boolean {
    return !!(
      this.clientId &&
      this.clientSecret &&
      this.tokenKeys.values.has(this.tokenKeys.current) &&
      this.webhookSecret &&
      this.apiUrl
    );
  }
}
