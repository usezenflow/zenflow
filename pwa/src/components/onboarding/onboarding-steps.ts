import { t } from "@/lib/i18n";
import { FOCUS_BANDS, type FocusBand } from "@zenflow/shared";

/**
 * Step order and pure helpers for first-run onboarding. Ported from
 * `mobile/lib/onboarding.ts` and `mobile/lib/focus-band.ts`.
 */

export const ONBOARDING_STEPS = [
  "focus",
  "campus",
  "commute",
  "notifications",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FIRST_STEP: OnboardingStep = "focus";

export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)];
}

export function prevStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.max(i - 1, 0)];
}

export function canGoBack(step: OnboardingStep): boolean {
  return step !== FIRST_STEP && step !== "done";
}

/** 1-based progress over the actionable steps (excludes "done"). */
export function stepProgress(step: OnboardingStep): {
  index: number;
  total: number;
} {
  return {
    index: Math.min(
      ONBOARDING_STEPS.indexOf(step) + 1,
      ONBOARDING_STEPS.length - 1,
    ),
    total: ONBOARDING_STEPS.length - 1,
  };
}

/** Local start and end of each focus band, as `HH:mm`. */
export const FOCUS_BAND_HOURS: Record<FocusBand, { from: string; to: string }> =
  {
    MORNING: { from: "08:00", to: "12:00" },
    AFTERNOON: { from: "12:00", to: "17:00" },
    EVENING: { from: "17:00", to: "21:00" },
    LATE_NIGHT: { from: "21:00", to: "02:00" },
  };

/** Preselected so the step is one tap. */
export const DEFAULT_FOCUS_BAND: FocusBand = "MORNING";

const BAND_LABEL: Record<FocusBand, string> = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
  LATE_NIGHT: "Late night",
};

export interface FocusBandOption {
  band: FocusBand;
  label: string;
  /** Localized "{from} to {to}" range. */
  hours: string;
}

/** The four focus options in display order. Labels translate on each call. */
export function focusBandOptions(): FocusBandOption[] {
  return FOCUS_BANDS.map((band) => {
    const { from, to } = FOCUS_BAND_HOURS[band];
    return {
      band,
      label: t(BAND_LABEL[band]),
      hours: t("{from} to {to}", { from, to }),
    };
  });
}
