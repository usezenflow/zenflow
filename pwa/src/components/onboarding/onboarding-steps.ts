/** The connect rows of first-run onboarding, one screen. */
export const ONBOARDING_ROWS = ["campus", "calendar", "assistants"] as const;
export type OnboardingRow = (typeof ONBOARDING_ROWS)[number];

const OPEN_KEY = "zenflow:onboarding-open";

/** The row to reopen after a reload or the Google redirect. */
export function savedRow(): OnboardingRow | null {
  try {
    const saved = sessionStorage.getItem(OPEN_KEY) as OnboardingRow | null;
    return saved && ONBOARDING_ROWS.includes(saved) ? saved : null;
  } catch {
    return null;
  }
}

export function saveRow(row: OnboardingRow | null): void {
  try {
    if (row) sessionStorage.setItem(OPEN_KEY, row);
    else sessionStorage.removeItem(OPEN_KEY);
  } catch {
    // Resume is a convenience.
  }
}
