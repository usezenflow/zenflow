import { toast } from "@/lib/notify";
import { t } from "@/lib/i18n";
import { pickPlanOffer, timeLabel, type TimePickOffer } from "@/lib/plan-offer";

/**
 * The offer for a placed prep plan: two choices that stay until one is taken.
 * Keep keeps the applied time; Prefer moves the plan to the other one.
 * Dismissing keeps the applied time and records nothing.
 */
export function showTimePick(offer: TimePickOffer, tz: string): void {
  const { id, title, proposalId, primary, alternative } = offer;
  toast(t("Pick a time for your prep"), {
    icon: "lightbulb",
    description: title,
    duration: Infinity,
    onDismiss: () => offer.onDismiss?.(),
    action: {
      label: t("Prefer {when}", { when: timeLabel(alternative, tz) }),
      onClick: () => void pickPlanOffer(id, proposalId, "alternative", tz, alternative),
    },
    cancel: {
      label: t("Keep {when}", { when: timeLabel(primary, tz) }),
      onClick: () => void pickPlanOffer(id, proposalId, "primary", tz, alternative),
    },
  });
}
