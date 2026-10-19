import type { ConfigService } from "@nestjs/config";
import {
  DEFAULT_OVERRIDES,
  type SeasonOverrides,
} from "./core/seasonal-policy";

/**
 * The seasonal-policy overrides from config. All unset in production, where the
 * academic calendar decides; a benchmark sets them to compress weeks into seconds.
 */
export function seasonOverrides(config: ConfigService): SeasonOverrides {
  const window = config.get<string>("INGESTION_EXAM_WINDOW");
  const weekly = Number(
    config.get<number | string>("INGESTION_TIMETABLE_WEEKLY_MS"),
  );
  const marksAfter = config.get<number | string>(
    "INGESTION_MARKS_AFTER_EXAMS_MS",
  );
  return {
    examWindow:
      window === "open" || window === "closed"
        ? window
        : DEFAULT_OVERRIDES.examWindow,
    timetableWeeklyMs: Number.isFinite(weekly) && weekly > 0 ? weekly : null,
    marksAfterExamsMs:
      marksAfter !== undefined && Number.isFinite(Number(marksAfter))
        ? Number(marksAfter)
        : DEFAULT_OVERRIDES.marksAfterExamsMs,
  };
}
