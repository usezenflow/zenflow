import type { SessionCheckOffResponse } from "@zenflow/shared";
import { api } from "./base";
import { notifySessionsMutated } from "@/lib/session-cache";

/** How far a skip reaches on a recurring lecture. */
export type SkipScope = "occurrence" | "following" | "all";

/**
 * Set or undo a done (`complete`) or missed (`skip`) state. Returns the updated
 * session and the user's streak (`{ session, streak }`).
 */
export async function checkOff(
  id: string,
  kind: "complete" | "skip",
  on: boolean,
  scope?: SkipScope,
): Promise<SessionCheckOffResponse> {
  const path = `/sessions/${encodeURIComponent(id)}/${kind}`;
  const config = scope && scope !== "occurrence" ? { params: { scope } } : undefined;
  const { data } = on ? await api.post(path, undefined, config) : await api.delete(path, config);
  notifySessionsMutated();
  return data.data;
}

/** Mark one session done or missed without reading the response. Idempotent on the server. */
export async function markSession(
  id: string,
  kind: "complete" | "skip",
): Promise<void> {
  await checkOff(id, kind, true);
}
