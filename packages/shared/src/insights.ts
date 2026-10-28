/** Read-only aggregates and replan: `GET /sessions/recap`, `GET /sessions/free-slots`, `POST /sessions/replan`. */

export interface RecapDay {
  date: string;
  weekday: string;
  minutesByType: Record<string, number>;
  busyMinutes: number;
  freeMinutes: number;
  longestFreeBlockMinutes: number;
  firstStart: string | null;
  lastEnd: string | null;
}

export interface RecapDeadline {
  title: string;
  deadline: string | null;
  placed: boolean;
  slackMinutes: number | null;
}

export interface RecapResponse {
  timezone: string;
  days: RecapDay[];
  /** 7 rows (Monday first) of 24 busy minutes per hour. */
  hourHeat: number[][];
  deadlines: RecapDeadline[];
  totals: {
    hoursByType: Record<string, number>;
    busiestDay: { date: string; busyMinutes: number } | null;
    lightestDay: { date: string; busyMinutes: number } | null;
    unplacedTasks: number;
  };
  gaps: {
    daysWithoutLunchBreak: string[];
    heavyEvenings: string[];
    hasOvernightDnd: boolean;
  };
  insights: string[];
  rhythm?: { bestStartHours: number[] };
}

export interface FreeSlot {
  start: string;
  end: string;
  freeMinutes: number;
}

export type FreeSlotsResponse = FreeSlot[];

export type ReplanChange = "free" | "balanced";

export interface ReplanMove {
  id: string;
  title: string;
  from: string;
  to: string;
  deadline: string;
}

export interface ReplanPreview {
  moves: ReplanMove[];
  unchanged: number;
  unplaced: { id: string; title: string }[];
}

export interface ReplanApplied extends ReplanPreview {
  undoGroupId: string | null;
}
