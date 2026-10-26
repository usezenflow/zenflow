import { Text } from "@/components/ui/text";
import { useReducedMotion, timeTo } from "@/lib/motion";
import { useEffect } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
} from "react-native-reanimated";

const STAGGER_MS = 110;

function Word({ word, index, className }: { word: string; index: number; className?: string }) {
  const reduce = useReducedMotion();
  const v = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    v.value = withDelay(index * STAGGER_MS, timeTo(1, reduce, 420));
  }, [v, index, reduce]);
  const style = useAnimatedStyle(() => ({
    opacity: v.value,
    transform: [{ translateY: (1 - v.value) * 10 }],
  }));
  return (
    <Animated.View style={style}>
      <Text className={className}>{word}</Text>
    </Animated.View>
  );
}

/** Aceternity "text generate": words fade up one after another. */
export function TextGenerate({ text, className }: { text: string; className?: string }) {
  return (
    <View className="flex-row flex-wrap justify-center gap-x-2">
      {text.split(" ").map((w, i) => (
        <Word key={`${w}-${i}`} word={w} index={i} className={className} />
      ))}
    </View>
  );
}
