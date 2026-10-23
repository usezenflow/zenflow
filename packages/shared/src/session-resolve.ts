/**
 * `data` of `POST /sessions/:id/resolve-conflicts`. `moved` lists the sessions
 * that changed start; `lateSessionIds` are those now past their deadline.
 */
export interface SessionResolveConflictsResponse {
  moved: string[];
  lateSessionIds: string[];
  /** Absent when nothing moved. */
  undoGroupId?: string;
}
