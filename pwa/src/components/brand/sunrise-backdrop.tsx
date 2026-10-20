import type { CSSProperties } from "react";

/**
 * Login backdrop: an aurora of the logo's own gradient, the web twin of
 * mobile's `SunriseBackdrop`. Four soft blobs drift out of phase over a
 * sunrise sweep. Decorative only; motion stops under reduced-motion.
 */
const BLOBS: {
  id: string;
  color: string;
  x: string;
  y: string;
  size: string;
  dx: string;
  dy: string;
  ms: number;
  peak: [number, number];
}[] = [
  { id: "orange", color: "#FF6900", x: "12%", y: "86%", size: "95vmax", dx: "150px", dy: "-110px", ms: 7000, peak: [0.18, 0.16] },
  { id: "amber", color: "#F0B100", x: "88%", y: "62%", size: "80vmax", dx: "-130px", dy: "100px", ms: 9000, peak: [0.15, 0.14] },
  { id: "lime", color: "#D8F999", x: "90%", y: "6%", size: "85vmax", dx: "-120px", dy: "130px", ms: 11000, peak: [0.3, 0.12] },
  { id: "peach", color: "#FFA66B", x: "5%", y: "14%", size: "70vmax", dx: "130px", dy: "90px", ms: 8000, peak: [0.16, 0.12] },
];

export function SunriseBackdrop() {
  return (
    <div aria-hidden className="sunrise-backdrop pointer-events-none absolute inset-0 overflow-hidden">
      <div className="sunrise-sweep absolute inset-0" />
      {BLOBS.map((b) => (
        <span
          key={b.id}
          className="sunrise-blob absolute rounded-full"
          style={
            {
              "--color": b.color,
              "--peak-light": b.peak[0],
              "--peak-dark": b.peak[1],
              "--dx": b.dx,
              "--dy": b.dy,
              "--ms": `${b.ms}ms`,
              left: b.x,
              top: b.y,
              width: b.size,
              height: b.size,
              translate: "-50% -50%",
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
