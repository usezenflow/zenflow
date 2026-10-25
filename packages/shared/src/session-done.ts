/**
 * `POST /sessions/:id/done` and `DELETE /sessions/:id/done`. `done` is the state
 * after the call: true when the placed TASK has a DONE event.
 */
export interface SessionDoneResponse {
  done: boolean;
}
