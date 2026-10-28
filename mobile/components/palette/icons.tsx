import Svg, { Circle, Path, Rect } from "react-native-svg";

/** Stroke paths of mockups/command-palette.html (24px viewBox, round caps). */
export const PATHS = {
  plus: "M12 5v14M5 12h14",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  find: "M12 3v3M5 12H2M22 12h-3M7 7 5 5M17 7l2-2M6 18a6 6 0 0 1 12 0",
  bars: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  replan:
    "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  pencil: "M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4",
  wand: "M3 21 15 9M15 6l3 3M18 3v4M16 5h4M7 3v3M5.5 4.5h3M19 14v3M17.5 15.5h3",
  check:
    "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9",
  clock: "M12 9v4l2.5 2M9.5 2h5",
  flag: "M5 21V4M5 4h12l-2.5 4L17 12H5",
  calendar: "M3 10h18M8 3v4M16 3v4",
  pin: "M12 21s7-6 7-12a7 7 0 0 0-14 0c0 6 7 12 7 12z",
  moon: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z",
  sliders: "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0",
  flame:
    "M12 22c4 0 7-2.8 7-7 0-3-1.8-5-3.5-7-.3 1.8-1.3 3-2.5 3 .5-3-1-6-4-8 .3 4-4 6-4 12 0 4.2 3 7 7 7z",
  sun: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
  x: "M6 6l12 12M18 6 6 18",
  undo: "M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11",
  tick: "M5 12.5l4.5 4.5L19 7",
  warn: "M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  cloudOff:
    "M3 3l18 18M9 5a6 6 0 0 1 9.5 4.5A4.5 4.5 0 0 1 20 17M5.5 10A5 5 0 0 0 7 19h10",
  scale:
    "M12 3v18M6 21h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0zM19 7l-3 7a3 3 0 0 0 6 0z",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01",
} as const;

export type IconName = keyof typeof PATHS;

/** One stroke icon; a few names carry an extra shape of their own. */
export function Ico({
  name,
  size = 18,
  color,
  stroke = 2.2,
}: {
  name: IconName;
  size?: number;
  color: string;
  stroke?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d={PATHS[name]} />
      {name === "clock" && <Circle cx={12} cy={13} r={8} />}
      {name === "calendar" && (
        <Rect x={3} y={5} width={18} height={16} rx={2} />
      )}
      {name === "pin" && <Circle cx={12} cy={9} r={2.5} />}
      {name === "sun" && <Circle cx={12} cy={12} r={4} />}
    </Svg>
  );
}
