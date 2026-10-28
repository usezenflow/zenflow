import { SPRING, springTo, useReducedMotion } from "@/lib/motion";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue } from "react-native-reanimated";

/** Aceternity "lamp" feel: a thin track with a glowing orange fill. */
export function LampProgress({ step, total }: { step: number; total: number }) {
  const reduce = useReducedMotion();
  const p = useSharedValue(0);
  useEffect(() => {
    p.value = springTo((step + 1) / total, reduce, SPRING.flow);
  }, [p, step, total, reduce]);
  const fill = useAnimatedStyle(() => ({ width: `${p.value * 100}%` }));
  return (
    <View className="h-1.5 overflow-hidden rounded-full bg-foreground/10">
      <Animated.View
        className="h-full rounded-full bg-primary"
        style={[
          fill,
          { shadowColor: "#FF8E3E", shadowOpacity: 0.9, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
        ]}
      />
    </View>
  );
}
