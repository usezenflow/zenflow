import { useReducedMotion } from "@/lib/motion";
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Defs, Ellipse, RadialGradient, Stop } from "react-native-svg";

/** Aceternity "spotlight": a warm cone of light that sweeps behind the hero. */
export function Spotlight({ width = 320, height = 320 }: { width?: number; height?: number }) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    const ease = { duration: 3200, easing: Easing.inOut(Easing.sin) };
    x.value = withRepeat(withSequence(withTiming(40, ease), withTiming(-40, ease)), -1, true);
  }, [x, reduce]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }, style]}>
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="zf-spot" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#FFF085" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#FF8E3E" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={width / 2} cy={height / 2} rx={width / 2} ry={height / 2} fill="url(#zf-spot)" />
      </Svg>
    </Animated.View>
  );
}
