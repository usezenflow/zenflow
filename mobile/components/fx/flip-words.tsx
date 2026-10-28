import { Text } from "@/components/ui/text";
import { useReducedMotion } from "@/lib/motion";
import { useEffect, useState } from "react";
import Animated, { FadeInDown, FadeOutUp } from "react-native-reanimated";

/** Aceternity "flip words": one word at a time swaps in place. */
export function FlipWords({ words, className }: { words: string[]; className?: string }) {
  const reduce = useReducedMotion();
  const [i, setI] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setI((n) => (n + 1) % words.length), 1800);
    return () => clearInterval(id);
  }, [words.length, reduce]);
  return (
    <Animated.View
      key={i}
      entering={reduce ? undefined : FadeInDown.duration(300)}
      exiting={reduce ? undefined : FadeOutUp.duration(200)}
    >
      <Text className={className}>{words[i]}</Text>
    </Animated.View>
  );
}
