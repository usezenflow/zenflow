import {
  listCourseColours,
  resetCourseColour,
  setCourseColour,
} from "@/api/course-colours";
import { useTheme } from "@/lib/theme";
import {
  COURSE_SWATCHES,
  SESSION_TINT_ALPHA,
  courseSwatchIndex,
  hexAlpha,
  type Scheme,
} from "@zenflow/core";
import { useEffect } from "react";
import { create } from "zustand";

/** Raw colours a session paints with when it has a course. */
export interface CourseStyle {
  /** Block or pill fill: the swatch at 12% light, 22% dark. */
  tint: string;
  /** Stripe and dot. */
  stripe: string;
  /** Text on the tint, AA per scheme. */
  ink: string;
}

/**
 * The course colour for a session, or `null` when it belongs to no course.
 * Mirrors `mobile/lib/course-colour.ts`.
 */
export function courseStyleFor(
  courseKey: string | null,
  overrides: ReadonlyMap<string, number>,
  scheme: Scheme,
): CourseStyle | null {
  if (!courseKey) return null;
  const swatch = COURSE_SWATCHES[courseSwatchIndex(courseKey, overrides)];
  return {
    tint: hexAlpha(swatch.base, SESSION_TINT_ALPHA[scheme]),
    stripe: swatch.base,
    ink: swatch.ink[scheme],
  };
}

interface CourseColourState {
  /** The user's own picks, keyed by `courseKey`. Unpicked courses use their automatic colour. */
  overrides: Map<string, number>;
  loaded: boolean;
  load: () => Promise<void>;
  setColour: (courseKey: string, swatch: number) => Promise<void>;
  resetColour: (courseKey: string) => Promise<void>;
}

export const useCourseColourStore = create<CourseColourState>((set, get) => ({
  overrides: new Map(),
  loaded: false,

  load: async () => {
    try {
      const colours = await listCourseColours();
      set({
        overrides: new Map(colours.map((c) => [c.courseKey, c.swatch])),
        loaded: true,
      });
    } catch {
      // Offline or signed out: keep the last known picks.
    }
  },

  setColour: async (courseKey, swatch) => {
    const next = new Map(get().overrides);
    next.set(courseKey, swatch);
    set({ overrides: next });
    try {
      await setCourseColour(courseKey, swatch);
    } catch {
      await get().load();
    }
  },

  resetColour: async (courseKey) => {
    const next = new Map(get().overrides);
    next.delete(courseKey);
    set({ overrides: next });
    try {
      await resetCourseColour(courseKey);
    } catch {
      await get().load();
    }
  },
}));

/**
 * Course colour lookup for the signed-in user. Loads the picks once, then
 * `styleFor(courseKey)` gives the tint, stripe and ink for the current scheme.
 */
export function useCourseColours() {
  const overrides = useCourseColourStore((s) => s.overrides);
  const loaded = useCourseColourStore((s) => s.loaded);
  const load = useCourseColourStore((s) => s.load);
  const setColour = useCourseColourStore((s) => s.setColour);
  const resetColour = useCourseColourStore((s) => s.resetColour);

  // Re-render when the theme flips; the `dark` class is set before listeners run.
  useTheme();
  const scheme: Scheme = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return {
    overrides,
    styleFor: (courseKey: string | null) =>
      courseStyleFor(courseKey, overrides, scheme),
    setColour,
    resetColour,
  };
}
