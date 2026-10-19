import { type CheckState, checkStateOf } from "@/lib/today-summary";
import type { Session } from "@zenflow/shared";

/** Done state of a row, derived from the session. Rows have no check-off control. */
export function useSessionCheck(session: Session): { done: boolean; state: CheckState } {
  const state = checkStateOf(session);
  return { done: state === "done", state };
}
