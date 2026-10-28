import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from "react-native-svg";

export type StepMarkKind = "campus" | "calendar" | "assistant" | "done";

/** Logo-gradient sun with a white glyph per step (campus book, calendar, sparkle, check). */
export function StepMark({ kind, size = 132 }: { kind: StepMarkKind; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 260 260" fill="none">
      <Defs>
        <LinearGradient id="zf-step" x1={48.5} y1={31.5} x2={222.5} y2={220.5} gradientUnits="userSpaceOnUse">
          <Stop stopColor="#FF6900" offset={0} />
          <Stop stopColor="#F0B100" offset={0.323567} />
          <Stop stopColor="#D8F999" offset={1} />
        </LinearGradient>
      </Defs>
      <Circle cx={130} cy={130} r={126} fill="url(#zf-step)" />
      <Circle cx={130} cy={130} r={104} stroke="#FFF085" strokeOpacity={0.6} strokeWidth={4} strokeDasharray="2 14" strokeLinecap="round" />
      {kind === "campus" && (
        <Path d="M130 96C110 84 84 84 66 92V178C84 170 110 170 130 182C150 170 176 170 194 178V92C176 84 150 84 130 96ZM130 96V182" stroke="#fff" strokeWidth={14} strokeLinejoin="round" strokeLinecap="round" />
      )}
      {kind === "calendar" && (
        <>
          <Rect x={70} y={88} width={120} height={104} rx={20} stroke="#fff" strokeWidth={14} />
          <Path d="M70 124H190M104 70V100M156 70V100" stroke="#fff" strokeWidth={14} strokeLinecap="round" />
        </>
      )}
      {kind === "assistant" && (
        <Path d="M130 66L148 112L194 130L148 148L130 194L112 148L66 130L112 112Z" fill="#fff" />
      )}
      {kind === "done" && (
        <Path d="M82 134L116 168L180 96" stroke="#fff" strokeWidth={18} strokeLinecap="round" strokeLinejoin="round" />
      )}
    </Svg>
  );
}
