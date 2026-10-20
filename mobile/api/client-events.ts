import type {
  ClientEventInput,
  RecordClientEventsResponse,
} from "@zenflow/shared";
import { api } from "./base";

/**
 * Reports what the student was shown or did (`POST /client-events`). Best
 * effort: a failed report is dropped, never shown to the student.
 */
export async function recordClientEvents(
  events: ClientEventInput[],
): Promise<RecordClientEventsResponse | null> {
  try {
    const { data } = await api.post("/client-events", { events });
    return data.data;
  } catch {
    return null;
  }
}
