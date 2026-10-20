/** `data` of `POST /sessions/:id/start`. `recorded` is false outside the block or when already recorded. */
export interface SessionStartResponse {
  recorded: boolean;
}
