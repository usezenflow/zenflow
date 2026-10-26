import { PublicUrls } from "../common/config/public-urls";
import { CalendarImportService } from "./calendar-import.service";
import { CalendarPullService } from "./calendar-pull.service";
import { CalendarSyncService } from "./calendar-sync.service";
import { CalendarWatchService } from "./calendar-watch.service";
import { GoogleCalendarClient } from "./google-calendar.client";
import { GoogleCalendarConfig } from "./google-calendar.config";
import { GoogleOAuthService } from "./google-oauth.service";

/** The sync machinery shared by the API (connect, webhook) and the worker (jobs). */
export const GOOGLE_CALENDAR_CORE = [
  PublicUrls,
  GoogleCalendarConfig,
  GoogleCalendarClient,
  GoogleOAuthService,
  CalendarWatchService,
  CalendarSyncService,
  CalendarPullService,
  CalendarImportService,
];
