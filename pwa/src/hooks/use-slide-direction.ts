import { useState } from "react";

export type SlideDirection = "next" | "prev";

/**
 * Remembers which way a position last moved, so a keyed element can slide in
 * from the side it moved toward. Key the element on `position`.
 */
export function useSlideDirection(position: number) {
  const [slide, setSlide] = useState({ position, direction: "next" as SlideDirection });
  if (slide.position !== position) {
    setSlide({ position, direction: position > slide.position ? "next" : "prev" });
  }
  return slide;
}
