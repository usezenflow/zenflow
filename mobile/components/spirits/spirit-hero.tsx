import { Flame, Sparkles, Target, Trophy } from "@/components/Icons";
import { EggRing } from "@/components/spirits/egg-ring";
import { SpiritArt } from "@/components/spirits/spirit-art";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { useReducedMotion } from "@/lib/motion";
import { eggProgress, PERK_COPY, RARITY_GLOW } from "@/lib/spirit-collection";
import { heroMotivation, nextPerk } from "@/lib/spirit-motivation";
import type { SpiritsResponse } from "@zenflow/shared";
import type { SpiritId } from "@zenflow/spirits";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

const HERO: [string, string] = ["#1f2d4d", "#3b2a63"];
const INK = "#fbf6ef";
const MUTED_INK = "rgba(251, 246, 239, 0.72)";
const GOLD = "#FFD23F";
const VISUAL = 128;
const PIP_COUNT = 5;

/**
 * The top of the Spirits tab. It shows the companion or the egg, the one line
 * the student needs next, the hatch button when the egg is ready, and the
 * power and collection chips.
 */
export function SpiritHero({
  data,
  companion,
  hatching,
  failed,
  onHatch,
}: {
  data: SpiritsResponse;
  companion: SpiritId | null;
  hatching: boolean;
  failed: boolean;
  onHatch: () => void;
}) {
  const { egg, collection, power, maxPower, perks } = data;
  const ready = egg.status === "ready";
  const owned = collection.filter((c) => c.count > 0).length;
  const motivation = heroMotivation(data);
  const next = nextPerk(perks);
  const glow = companion ? RARITY_GLOW[collection.find((c) => c.spiritId === companion)?.rarity ?? "common"] : GOLD;

  const reduceMotion = useReducedMotion();
  const pulse = useSharedValue(0.35);
  useEffect(() => {
    if (reduceMotion || !ready) {
      pulse.value = 0.35;
      return;
    }
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.75, { duration: 1100 }),
        withTiming(0.35, { duration: 1100 }),
      ),
      -1,
    );
  }, [ready, reduceMotion, pulse]);
  const halo = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View className="overflow-hidden rounded-[28px] p-5">
      <LinearGradient colors={HERO} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      <View className="flex-row items-center gap-5">
        <View className="items-center justify-center" style={{ width: VISUAL, height: VISUAL }}>
          <Animated.View
            pointerEvents="none"
            style={[
              { position: "absolute", width: VISUAL, height: VISUAL, borderRadius: VISUAL / 2, backgroundColor: glow },
              halo,
            ]}
          />
          {companion ? (
            <SpiritArt id={companion} size={VISUAL - 8} />
          ) : (
            <EggRing progress={eggProgress(egg.sparks, egg.sparksNeeded)} size={VISUAL}>
              {/* The egg's species is unknown until it hatches, so it is drawn locked. */}
              <SpiritArt id="fox" stage="egg" mood="locked" size={VISUAL - 40} />
            </EggRing>
          )}
        </View>

        <View className="flex-1 gap-3">
          <Text className="text-[18px] font-semibold leading-6" style={{ color: INK }}>
            {t(motivation.key, motivation.values)}
          </Text>

          {ready ? (
            <Pressable
              onPress={onHatch}
              disabled={hatching}
              accessibilityRole="button"
              accessibilityLabel={t("Hatch")}
              className="flex-row items-center gap-2 self-start rounded-full px-5 py-3"
              style={{ backgroundColor: GOLD, opacity: hatching ? 0.7 : 1 }}
            >
              {hatching ? (
                <ActivityIndicator size="small" color="#2b1406" />
              ) : (
                <Sparkles size={18} color="#2b1406" />
              )}
              <Text className="text-[15px] font-bold" style={{ color: "#2b1406" }}>
                {t("Hatch")}
              </Text>
            </Pressable>
          ) : (
            <View className="gap-2">
              <View className="flex-row gap-1.5">
                {Array.from({ length: PIP_COUNT }, (_, i) => (
                  <Sparkles
                    key={i}
                    size={18}
                    color={i < egg.sparks ? GOLD : "rgba(251, 246, 239, 0.25)"}
                  />
                ))}
              </View>
              <Text className="text-sm" style={{ color: MUTED_INK }}>
                {t("{count} of {total} starts to hatch", { count: egg.sparks, total: egg.sparksNeeded })}
              </Text>
            </View>
          )}

          {failed ? (
            <Text className="text-sm" style={{ color: "#ffb4a8" }}>
              {t("Could not hatch. Try again.")}
            </Text>
          ) : null}
        </View>
      </View>

      <View className="mt-5 flex-row flex-wrap gap-2">
        <Chip icon={<Flame size={14} color={GOLD} />} label={t("Power {power} of {max}", { power, max: maxPower })} />
        <Chip icon={<Trophy size={14} color={GOLD} />} label={t("{count} of {total}", { count: owned, total: collection.length })} />
      </View>

      <View className="mt-3 flex-row items-center gap-2">
        <Target size={14} color={MUTED_INK} />
        <Text className="flex-1 text-sm" style={{ color: MUTED_INK }}>
          {next
            ? t("{points} power to unlock {perk}", {
                points: next.power - power,
                perk: PERK_COPY[next.key] ? t(PERK_COPY[next.key].title) : t("Zendeck perk"),
              })
            : data.perks.length > 0
              ? t("All perks unlocked")
              : null}
        </Text>
      </View>
    </View>
  );
}

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5 rounded-full px-3 py-1.5" style={{ backgroundColor: "rgba(251, 246, 239, 0.12)" }}>
      {icon}
      <Text className="text-xs font-semibold" style={{ color: INK }}>
        {label}
      </Text>
    </View>
  );
}
