import { t } from "@/lib/i18n";
import type { Verb } from "./command";

interface State {
  verb: Verb;
  targets: number;
  hasAction: boolean;
  minutes: number | null;
  hasRange: boolean;
  hasMode: boolean;
  hasSlot: boolean;
}

/** What the field asks for next, given the chips already picked. */
export function placeholderFor(s: State): string {
  switch (s.verb) {
    case "edit":
      return !s.targets
        ? t("Type @ to pick a task")
        : s.hasAction
          ? t("Send to apply")
          : t("Pick a change, or type it");
    case "delete":
      return s.targets ? t("Send to delete") : t("Type @ to pick a task");
    case "free":
      return !s.minutes
        ? t("Pick a length")
        : !s.hasRange
          ? t("Pick a range, or type it")
          : s.hasSlot
            ? t("Type a title for the slot")
            : t("Pick a slot below");
    case "replan":
      return !s.hasRange
        ? t("Pick a range, or type it")
        : s.hasMode
          ? ""
          : t("Pick how to replan");
    case "view":
    case "recap":
      return s.hasRange ? "" : t("Pick a range, or type it");
    case "undo":
      return t("Send to undo");
    default:
      return t("Type a task or a command");
  }
}
