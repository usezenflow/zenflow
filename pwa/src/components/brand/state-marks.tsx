/** The logo's middle curve (components/logo.tsx). */
const CURVE =
  "M220.5 51.5C220.5 51.5 172.668 65.7587 147.635 89.6235C122.602 113.488 136.249 158.201 104.912 183.517C80.2542 203.436 32.9999 199.5 32.9999 199.5";

const SUNRISE_STOPS = [
  { offset: 0, color: "#FF6900" },
  { offset: 0.323567, color: "#F0B100" },
  { offset: 1, color: "#D8F999" },
];

const DUSK_STOPS = [
  { offset: 0, color: "#C9A58C" },
  { offset: 0.45, color: "#B9AE9C" },
  { offset: 1, color: "#C8C7B4" },
];

function Gradient({ id, stops }: { id: string; stops: typeof SUNRISE_STOPS }) {
  return (
    <linearGradient
      id={id}
      x1={48.5}
      y1={31.5}
      x2={222.5}
      y2={220.5}
      gradientUnits="userSpaceOnUse"
    >
      {stops.map((stop) => (
        <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
      ))}
    </linearGradient>
  );
}

/** No results: a faded sun with the curve as a dotted trail (mockups/brand-loader.html). */
export function NoResultsMark({ size = 84 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 260 260" fill="none" aria-hidden="true">
      <defs>
        <Gradient id="zf-noresults" stops={SUNRISE_STOPS} />
      </defs>
      <circle cx={130} cy={130} r={126} fill="url(#zf-noresults)" opacity={0.28} />
      <circle
        cx={130}
        cy={130}
        r={126}
        stroke="#FF8E3E"
        strokeOpacity={0.45}
        strokeWidth={5}
        strokeDasharray="2 14"
        strokeLinecap="round"
      />
      <path
        d={CURVE}
        pathLength={100}
        stroke="#FF8E3E"
        strokeWidth={20}
        strokeLinecap="round"
        strokeDasharray="0.1 9.9"
      />
    </svg>
  );
}

/** Load failed: a dimmed sun with a break in the curve (mockups/brand-loader.html). */
export function ErrorMark({ size = 84 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 260 260" fill="none" aria-hidden="true">
      <defs>
        <Gradient id="zf-error" stops={DUSK_STOPS} />
      </defs>
      <circle cx={130} cy={130} r={130} fill="url(#zf-error)" />
      <path
        d={CURVE}
        pathLength={100}
        stroke="#F4EBDD"
        strokeWidth={24}
        strokeLinecap="round"
        strokeDasharray="40 20 100"
      />
    </svg>
  );
}

/** Empty: a soft sun with the curve at rest, solid (nothing was searched for). */
export function EmptyMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 260 260" fill="none" aria-hidden="true">
      <defs>
        <Gradient id="zf-empty" stops={SUNRISE_STOPS} />
      </defs>
      <circle cx={130} cy={130} r={130} fill="url(#zf-empty)" opacity={0.3} />
      <path d={CURVE} stroke="#FF8E3E" strokeWidth={22} strokeLinecap="round" />
    </svg>
  );
}
