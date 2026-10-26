import type { GoogleCalendarConnectResponse, GoogleCalendarStatus, SetCalendarTargetInput, User } from "@zenflow/shared";
import { api } from "./base";

export async function getGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const { data } = await api.get("/google-calendar");
  return data.data;
}

/** Turns the phone calendar on or off. Fails with 409 while Google Calendar is connected. */
export async function setCalendarTarget(target: SetCalendarTargetInput["target"]): Promise<User> {
  const { data } = await api.patch("/users/update/calendar-target", { target } satisfies SetCalendarTargetInput);
  return data.data;
}

/** The Google sign-in address to open in the browser. */
export async function startGoogleCalendar(): Promise<GoogleCalendarConnectResponse> {
  const { data } = await api.post("/google-calendar/connect");
  return data.data;
}

export async function syncGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const { data } = await api.post("/google-calendar/sync");
  return data.data;
}

export async function disconnectGoogleCalendar(): Promise<GoogleCalendarStatus> {
  const { data } = await api.delete("/google-calendar");
  return data.data;
}
