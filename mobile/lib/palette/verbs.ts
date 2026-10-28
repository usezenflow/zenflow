import type {
  FreeSlotsResponse,
  RecapResponse,
  ReplanChange,
  ReplanPreview,
  Session,
} from "@zenflow/shared";
import { addDays, differenceInCalendarDays } from "date-fns";
import {
  confirmReplan,
  getFreeSlots,
  getRecap,
  previewReplan,
  undoLatest,
} from "@/api/insights";
import { t } from "@/lib/i18n";
import { listSessions } from "@/api/tasks";
import type { Range, Verb } from "./command";
import { freeAfterNow } from "./free-now";

/** What a read or preview verb returns; the screen renders each kind as its own panel. */
export type VerbResult =
  | {
      kind: "recap";
      recap: RecapResponse;
      prev: RecapResponse | null;
      range: Range;
    }
  | { kind: "free"; slots: FreeSlotsResponse }
  | { kind: "replan"; preview: ReplanPreview; confirm: () => Promise<string> }
  | { kind: "view"; sessions: Session[]; range: Range }
  | { kind: "undo"; message: string };

/** Runs a read or preview verb over a range the user picked. Delete and edit act on `@` chips instead. */
export async function runVerb(
  verb: Verb,
  range: Range | null,
  minutes: number | null,
  mode?: ReplanChange | null,
): Promise<VerbResult | null> {
  if (verb === "undo") {
    const { restored } = await undoLatest();
    return {
      kind: "undo",
      message: restored.length
        ? t("Undid {n} changes", { n: restored.length })
        : t("Nothing to undo"),
    };
  }
  if (!range) return null;
  const { from, to } = range;
  switch (verb) {
    case "recap":
      const days = differenceInCalendarDays(to, from) + 1;
      const [recap, prev] = await Promise.all([
        getRecap(from, to),
        getRecap(addDays(from, -days), addDays(to, -days)).catch(() => null),
      ]);
      return { kind: "recap", recap, prev, range };
    case "free":
      return {
        kind: "free",
        slots: await freeAfterNow(
          await getFreeSlots(from, to, minutes ?? 60),
          minutes ?? 60,
        ),
      };
    case "replan": {
      const preview = await previewReplan(from, to, mode ?? undefined);
      return {
        kind: "replan",
        preview,
        confirm: async () => {
          await confirmReplan(from, to, mode ?? undefined);
          return t("Replanned {n} changes", { n: preview.moves.length });
        },
      };
    }
    case "view":
      return {
        kind: "view",
        sessions: (await listSessions(from, to)).sessions,
        range,
      };
    default:
      return null;
  }
}
