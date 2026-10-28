import { useReducedMotion } from "@/lib/motion";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

const SIZE = 800;

/** Aceternity "moving border": a sunrise gradient ring that circles its child. */
export function MovingBorder({
  radius = 999,
  width = 2,
  children,
}: {
  radius?: number;
  width?: number;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    r.value = withRepeat(withTiming(360, { duration: 4200, easing: Easing.linear }), -1);
    return () => cancelAnimation(r);
  }, [r, reduce]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return (
    <View style={{ borderRadius: radius, overflow: "hidden", padding: width }}>
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute",
            top: "50%",
            left: "50%",
            width: SIZE,
            height: SIZE,
            marginTop: -SIZE / 2,
            marginLeft: -SIZE / 2,
          },
          spin,
        ]}
      >
        <LinearGradient
          colors={["#FF8E3E", "#F0B100", "#D8F999", "#FFF085", "#FF8E3E"]}
          style={{ flex: 1 }}
        />
      </Animated.View>
      <View style={{ borderRadius: radius - width, overflow: "hidden" }}>{children}</View>
    </View>
  );
}
