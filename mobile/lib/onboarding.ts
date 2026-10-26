import { t } from "./i18n";

/**
 * Pure routing + step-state logic for first-run onboarding (issue #88).
 * RN-free so it can be unit-tested (`lib/__tests__/onboarding.test.ts`).
 */

export const ONBOARDING_STEPS = [
  "dlu",
  "notifications",
  "assistants",
  "done",
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const FIRST_STEP: OnboardingStep = "dlu";

/** Next step, clamped at "done". */
export function nextStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)];
}

/** Previous step, clamped at the first (Back is hidden there). */
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

/** Where the auth gate should send the current session; null = stay put. */
export type AuthRoute = "/(auth)/login" | "/(onboarding)" | "/(app)/settings";

export function routeForSession(
  user: { onboardedAt: string | null } | null,
  group: string,
): AuthRoute | null {
  if (!user) return group === "(auth)" ? null : "/(auth)/login";
  if (!user.onboardedAt) {
    return group === "(onboarding)" ? null : "/(onboarding)";
  }
  // Onboarded: leave the auth/onboarding groups.
  return group === "(auth)" || group === "(onboarding)" ? "/(app)/settings" : null;
}

export type SetupItem = "notifications" | "dlu";

/** Steps still worth resuming from Settings, derived from real state. */
export function pendingSetupItems(state: {
  notificationsActive: boolean;
  dluConnected: boolean;
}): SetupItem[] {
  const items: SetupItem[] = [];
  if (!state.notificationsActive) items.push("notifications");
  if (!state.dluConnected) items.push("dlu");
  return items;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, number>();

/**
 * Current UTC offset of an IANA zone in minutes (0 if the zone is unknown).
 * Formatters are reused and results cached per zone per hour, so filtering the
 * full zone list on every keystroke doesn't rebuild hundreds of formatters.
 */
export function utcOffsetMinutes(tz: string, at: Date = new Date()): number {
  const key = `${tz}|${Math.floor(at.getTime() / 3_600_000)}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const value = computeUtcOffsetMinutes(tz, at);
  offsetCache.set(key, value);
  return value;
}

function computeUtcOffsetMinutes(tz: string, at: Date): number {
  try {
    let fmt = offsetFormatters.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
      offsetFormatters.set(tz, fmt);
    }
    const p = Object.fromEntries(
      fmt.formatToParts(at).map((x) => [x.type, Number(x.value)]),
    );
    const asUtc = Date.UTC(
      p.year,
      p.month - 1,
      p.day,
      p.hour,
      p.minute,
      p.second,
    );
    return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
  } catch {
    return 0;
  }
}

/**
 * Case-insensitive timezone search; "_" and " " are interchangeable. With
 * `near`, results are ordered by closeness to that zone (UTC-offset distance,
 * then same region, then name) instead of alphabetically, and `near` itself is
 * left out when there is no query (the UI shows it separately).
 */
export function filterTimezones(
  zones: readonly string[],
  query: string,
  limit = 50,
  near?: string,
): string[] {
  const q = query.trim().toLowerCase().replace(/\s+/g, "_");
  let hits = q ? zones.filter((z) => z.toLowerCase().includes(q)) : [...zones];
  if (near) {
    const now = new Date();
    const ref = utcOffsetMinutes(near, now);
    const region = near.split("/")[0];
    const dist = new Map(
      hits.map((z) => [z, Math.abs(utcOffsetMinutes(z, now) - ref)]),
    );
    hits.sort(
      (a, b) =>
        (dist.get(a) as number) - (dist.get(b) as number) ||
        Number(b.startsWith(`${region}/`)) -
          Number(a.startsWith(`${region}/`)) ||
        a.localeCompare(b),
    );
    if (!q) hits = hits.filter((z) => z !== near);
  }
  return hits.slice(0, limit);
}

/** "GMT+7", "GMT+5:30", "GMT" — derived from the offset, not Intl's shortOffset. */
export function gmtOffset(tz: string): string {
  const min = utcOffsetMinutes(tz);
  if (min === 0) return "GMT";
  const abs = Math.abs(min);
  const mm = abs % 60;
  return `GMT${min < 0 ? "-" : "+"}${Math.floor(abs / 60)}${
    mm ? `:${String(mm).padStart(2, "0")}` : ""
  }`;
}
