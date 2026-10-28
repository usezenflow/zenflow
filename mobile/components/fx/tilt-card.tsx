import { SPRING, springTo, useReducedMotion } from "@/lib/motion";
import type { ReactNode } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from "react-native-reanimated";

const MAX_DEG = 10;
const clamp = (n: number) => {
  "worklet";
  return Math.max(-MAX_DEG, Math.min(MAX_DEG, n));
};

/**
 * Aceternity "3D card": drag sideways and the card tilts in perspective, then
 * springs flat. Horizontal-only activation so the page still scrolls.
 */
export function TiltCard({ children }: { children: ReactNode }) {
  const reduce = useReducedMotion();
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const pan = Gesture.Pan()
    .enabled(!reduce)
    .activeOffsetX([-8, 8])
    .onUpdate((e) => {
      x.value = clamp(e.translationX / 8);
      y.value = clamp(-e.translationY / 8);
    })
    .onFinalize(() => {
      x.value = springTo(0, reduce, SPRING.flow);
      y.value = springTo(0, reduce, SPRING.flow);
    });
  const style = useAnimatedStyle(() => ({
    transform: [
      { perspective: 800 },
      { rotateY: `${x.value}deg` },
      { rotateX: `${y.value}deg` },
    ],
  }));
  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[{ width: "100%" }, style]}>{children}</Animated.View>
    </GestureDetector>
  );
}
