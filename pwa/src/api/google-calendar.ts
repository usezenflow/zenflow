import type {
  ApiSuccess,
  GoogleCalendarConnectResponse,
  GoogleCalendarStatus,
} from "@zenflow/shared";
import { api } from "./base";

export async function getGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const { data } = await api.get<ApiSuccess<GoogleCalendarStatus>>("/google-calendar");
  return data.data;
}

/** The Google sign-in address to send the browser to. */
export async function startGoogleCalendar(): Promise<GoogleCalendarConnectResponse> {
  const { data } = await api.post<ApiSuccess<GoogleCalendarConnectResponse>>(
    "/google-calendar/connect",
  );
  return data.data;
}

export async function syncGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const { data } = await api.post<ApiSuccess<GoogleCalendarStatus>>("/google-calendar/sync");
  return data.data;
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const { data } = await api.delete<ApiSuccess<GoogleCalendarStatus>>("/google-calendar");
  return data.data;
}
