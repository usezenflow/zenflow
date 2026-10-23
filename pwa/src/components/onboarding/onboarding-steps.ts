
/**
 * Step order and pure helpers for first-run onboarding. Ported from
 * `mobile/lib/onboarding.ts`.
 */

export const ONBOARDING_STEPS = [
  "campus",
  "commute",
  "notifications",
  "assistants",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FIRST_STEP: OnboardingStep = "campus";

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
