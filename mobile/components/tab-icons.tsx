import type { ColorValue } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

type TabIconProps = {
  // `Tabs.Screen`'s `tabBarIcon` (expo-router, re-vendored bottom-tabs) hands
  // this through as `ColorValue` (nullable) now, not a plain `string` --
  // matches what `Line`/`Rect`'s own `stroke`/`fill` props accept anyway.
  color: ColorValue;
  size: number;
};

/**
 * Tab bar glyphs. The calendar glyph is hand-ported from
 * mockups/week-view.html's tab bar (lucide's CalendarDays/LayoutGrid don't
 * match that mark).
 */
export function WeekTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect
        x={3}
        y={4}
        width={18}
        height={17}
        rx={2}
        stroke={color}
        strokeWidth={2}
      />
      <Line x1={3} y1={9} x2={21} y2={9} stroke={color} strokeWidth={2} />
      <Line x1={9} y1={9} x2={9} y2={21} stroke={color} strokeWidth={2} />
      <Line x1={15} y1={9} x2={15} y2={21} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Three rows with bullets: the List tab. */
export function ListTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Line x1={9} y1={6} x2={21} y2={6} stroke={color} strokeWidth={2} />
      <Line x1={9} y1={12} x2={21} y2={12} stroke={color} strokeWidth={2} />
      <Line x1={9} y1={18} x2={21} y2={18} stroke={color} strokeWidth={2} />
      <Circle cx={4.5} cy={6} r={1.2} fill={color} />
      <Circle cx={4.5} cy={12} r={1.2} fill={color} />
      <Circle cx={4.5} cy={18} r={1.2} fill={color} />
    </Svg>
  );
}

/** A head and shoulders: the Me tab. */
export function MeTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2} />
      <Path
        d="M4 21c0-4 3.6-7 8-7s8 3 8 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

const EGG_OUTLINE =
  "M100 34 C 136 34 156 98 156 128 C 156 162 132 182 100 182 C 68 182 44 162 44 128 C 44 98 64 34 100 34 Z";

/** The egg from the spirit art: the Spirits tab. */
export function SpiritTabIcon({ color, size }: TabIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 200 200" fill="none">
      <Path d={EGG_OUTLINE} stroke={color} strokeWidth={14} />
    </Svg>
  );
}
