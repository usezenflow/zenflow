import { useReducedMotion } from "@/lib/motion";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const COLORS = ["#FF8E3E", "#F0B100", "#D8F999", "#FFF085"];

// Deterministic so renders and tests are stable.
const rand = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

function Twinkle({ i }: { i: number }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(reduce ? 0.6 : 0);
  useEffect(() => {
    if (reduce) return;
    v.value = withDelay(
      rand(i + 1) * 2000,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: 900 }),
        ),
        -1,
      ),
    );
  }, [v, i, reduce]);
  const size = 4 + rand(i + 2) * 6;
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ scale: 0.4 + v.value * 0.9 }, { rotate: "45deg" }],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          left: `${rand(i + 3) * 100}%`,
          top: `${rand(i + 4) * 100}%`,
          width: size,
          height: size,
          borderRadius: 2,
          backgroundColor: COLORS[i % COLORS.length],
        },
        style,
      ]}
    />
  );
}

/** Aceternity "sparkles": soft diamonds that twinkle across the backdrop. */
export function Sparkles({ count = 18 }: { count?: number }) {
  const items = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {items.map((i) => (
        <Twinkle key={i} i={i} />
      ))}
    </View>
  );
}

function Piece({ i, count }: { i: number; count: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    p.value = withTiming(1, { duration: 1100 + rand(i) * 500, easing: Easing.out(Easing.cubic) });
  }, [p, i]);
  const angle = (i / count) * Math.PI * 2 + rand(i) * 0.5;
  const dist = 90 + rand(i + 7) * 90;
  const style = useAnimatedStyle(() => ({
    opacity: reduce ? 0 : 1 - p.value,
    transform: [
      { translateX: Math.cos(angle) * dist * p.value },
      { translateY: Math.sin(angle) * dist * p.value + p.value * p.value * 40 },
      { rotate: `${p.value * 240}deg` },
    ],
  }));
  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 8,
          height: 8,
          borderRadius: i % 2 ? 4 : 2,
          backgroundColor: COLORS[i % COLORS.length],
        },
        style,
      ]}
    />
  );
}

/** One-shot burst from the centre, for the finish screen. */
export function Burst({ count = 24 }: { count?: number }) {
  const items = useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}
    >
      {items.map((i) => (
        <Piece key={i} i={i} count={count} />
      ))}
    </View>
  );
}
