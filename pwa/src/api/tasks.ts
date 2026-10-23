import type {
  ConfirmPlacementRequest,
  ConfirmPlacementResponse,
  CreateSessionInput,
  CreateSessionResponse,
  DeadlineOptionsResponse,
  RemoveSessionResponse,
  Session,
  SessionDetailResponse,
  SessionSearchQuery,
  SessionSearchResponse,
  SessionsListResponse,
  SessionStartResponse,
  SlotPickRequest,
  SessionResolveConflictsResponse,
  SlotPickResponse,
  UpdateSessionInput,
  UndoPlacementResponse,
  UpdateSessionResponse,
  ViewMode,
} from "@zenflow/shared";
import { format } from "date-fns";
import { api } from "./base";

/**
 * No `status` param — the backend doesn't filter by status; a caller that
 * needs status filtering does it client-side over the returned `sessions`
 * array.
 */
export async function listSessions(
  view: ViewMode,
  date: Date,
): Promise<SessionsListResponse> {
  const { data } = await api.get("/sessions", {
    params: { view, date: format(date, "yyyy-MM-dd") },
  });
  return data.data;
}

/** One page of the agenda search, in ascending start order. */
export async function searchSessions(
  query: SessionSearchQuery,
): Promise<SessionSearchResponse> {
  const { data } = await api.get("/sessions/search", { params: query });
  return data.data;
}

export async function listSessionSuggestions(
  q: string,
  limit = 10,
): Promise<Session[]> {
  const { data } = await api.get("/sessions/suggestions", {
    params: { q, limit },
  });
  return data.data.suggestions;
}

export async function createSession(
  input: CreateSessionInput,
): Promise<CreateSessionResponse> {
  const { data } = await api.post("/sessions", input);
  return data.data;
}

/**
 * The six deadline quick-action chip values (Today/Tomorrow/This week/Next
 * week/This month/No rush), each an ISO-8601 instant derived from the
 * backend's `endOfPeriod` ceiling math relative to `anchor`.
 */
export async function getDeadlineOptions(
  anchor: string = new Date().toISOString(),
): Promise<DeadlineOptionsResponse> {
  const { data } = await api.get("/sessions/deadline-options", {
    params: { anchor },
  });
  return data.data;
}

/**
 * One generic update endpoint covers metadata edits, drag-reschedule and
 * resize. A change to a scheduled TASK's start/duration is recorded
 * server-side as a `MOVE` signal; there is no completion state.
 */
export async function updateSession(
  id: string,
  input: UpdateSessionInput,
): Promise<UpdateSessionResponse> {
  const { data } = await api.patch(
    `/sessions/${encodeURIComponent(id)}`,
    input,
  );
  return data.data;
}

/**
 * Records which side of a shown pairwise slot proposal the user picked — only
 * call this on an affirmative choice; a "keep current" dismissal can just
 * close the UI without hitting this endpoint.
 */
/** Records that the app is open inside a placed block. The server keeps one per slot. */
export async function recordSessionStart(id: string): Promise<SessionStartResponse> {
  const { data } = await api.post(`/sessions/${encodeURIComponent(id)}/start`);
  return data.data;
}

export async function slotPick(
  sessionId: string,
  body: SlotPickRequest,
): Promise<SlotPickResponse> {
  const { data } = await api.post(
    `/sessions/${encodeURIComponent(sessionId)}/slot-pick`,
    body,
  );
  return data.data;
}

export async function getSessionDetails(
  id: string,
): Promise<SessionDetailResponse> {
  const { data } = await api.get(`/sessions/${encodeURIComponent(id)}`);
  return data.data;
}

/** Delete one session. */
export async function removeSession(
  id: string,
): Promise<RemoveSessionResponse> {
  const { data } = await api.delete(`/sessions/${encodeURIComponent(id)}`);
  return data.data;
}

/** Record that the user started a session now (`POST /sessions/:id/start`). */
export async function startSession(id: string): Promise<void> {
  await api.post(`/sessions/${encodeURIComponent(id)}/start`);
}

/** Skip one session: it stays on the calendar, marked as skipped. */
export async function skipSession(id: string): Promise<Session> {
  const { data } = await api.post(`/sessions/${encodeURIComponent(id)}/skip`);
  return data.data;
}

/** Skip every meeting of a timetable group, regardless of time. */
export async function skipTimetableGroup(sessionId: string): Promise<void> {
  await api.post(`/sessions/timetable-group/${encodeURIComponent(sessionId)}/skip`);
}

/** Skip this meeting and every later one of its timetable group. */
export async function skipTimetableGroupFrom(sessionId: string): Promise<void> {
  await api.post(`/sessions/timetable-group/${encodeURIComponent(sessionId)}/skip/from`);
}

/**
 * Apply a plan the scheduler held for confirmation (`NEEDS_CONFIRMATION`).
 * Single use: a 409 `PLACEMENT_STALE` means the plan no longer holds.
 */
export async function confirmPlacement(planId: string): Promise<ConfirmPlacementResponse> {
  const body: ConfirmPlacementRequest = { planId };
  const { data } = await api.post("/sessions/placement/confirm", body);
  return data.data;
}

/** Repacks the sessions that overlap `id`; `id` stays where it is. */
export async function resolveConflicts(id: string): Promise<SessionResolveConflictsResponse> {
  const { data } = await api.post(`/sessions/${encodeURIComponent(id)}/resolve-conflicts`);
  return data.data;
}

/** Revert every move and create of one undo group (`undoGroupId` on a response). */
export async function undoPlacement(groupId: string): Promise<UndoPlacementResponse> {
  const { data } = await api.post(`/sessions/undo/${encodeURIComponent(groupId)}`);
  return data.data;
}

