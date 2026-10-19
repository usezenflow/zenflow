import { SpiritArt } from "@/components/spirits/spirit-art";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { RARITY_GLOW, RARITY_LABEL } from "@/lib/spirit-collection";
import { useReducedMotion } from "@/lib/motion";
import { SPIRITS, type SpiritId } from "@zenflow/spirits";
import type { SpiritRarity } from "@zenflow/shared";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const STAGE = 220;

/**
 * The hatch reveal: the egg fades while the spirit springs in over a rarity
 * glow. Under Reduce Motion the spirit is shown at once.
 */
export function HatchMoment({
  spiritId,
  rarity,
  onClose,
}: {
  spiritId: SpiritId;
  rarity: SpiritRarity;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const reveal = useSharedValue(reduceMotion ? 1 : 0);
  useEffect(() => {
    if (reduceMotion) return;
    reveal.value = withDelay(500, withSpring(1, { damping: 12, stiffness: 120 }));
  }, [reduceMotion, reveal]);

  const eggStyle = useAnimatedStyle(() => ({
    opacity: 1 - reveal.value,
    transform: [{ scale: 1 - 0.2 * reveal.value }],
  }));
  const spiritStyle = useAnimatedStyle(() => ({
    opacity: reveal.value,
    transform: [{ scale: 0.6 + 0.4 * reveal.value }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: withTiming(reveal.value * 0.55, { duration: 300 }),
  }));

  const spirit = SPIRITS.find((s) => s.id === spiritId);
  return (
    <Pressable
      onPress={onClose}
      accessibilityRole="button"
      accessibilityLabel={t("Continue")}
      className="absolute inset-0 items-center justify-center bg-background/95 px-8"
    >
      <View className="items-center justify-center" style={{ width: STAGE, height: STAGE }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: "absolute",
              width: STAGE,
              height: STAGE,
              borderRadius: STAGE / 2,
              backgroundColor: RARITY_GLOW[rarity],
            },
            glowStyle,
          ]}
        />
        <Animated.View pointerEvents="none" style={[{ position: "absolute" }, eggStyle]}>
          <SpiritArt id={spiritId} stage="egg" size={STAGE} />
        </Animated.View>
        <Animated.View pointerEvents="none" style={[{ position: "absolute" }, spiritStyle]}>
          <SpiritArt id={spiritId} size={STAGE} />
        </Animated.View>
      </View>
      <Text className="mt-6 text-sm text-muted-foreground">{t("New spirit")}</Text>
      <Text className="mt-1 text-[24px] font-bold">{spirit ? t(spirit.en) : ""}</Text>
      <Text className="mt-1 text-sm text-muted-foreground">{t(RARITY_LABEL[rarity])}</Text>
      <Text className="mt-8 text-sm font-semibold text-primary">{t("Continue")}</Text>
    </Pressable>
  );
}
