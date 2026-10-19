import { Check, Crown, Lock, Shield, Sparkles, Star, Target } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { PERK_COPY } from "@/lib/spirit-collection";
import { perkProgress } from "@/lib/spirit-motivation";
import type { SpiritPerk } from "@zenflow/shared";
import { ScrollView, View, useWindowDimensions } from "react-native";

const PERK_ICON = {
  examRadar: Target,
  smartPlans: Star,
  focusMode: Shield,
  askZendeck: Sparkles,
  seasonCrown: Crown,
} as const;

/** Content gutter of the tab. The rail runs edge to edge inside it. */
const GUTTER = 20;
const CARD_GAP = 12;
const LINE_HEIGHT = 20;
/** Three lines of body copy, so every card is the same height whatever the wording. */
const DESCRIPTION_HEIGHT = LINE_HEIGHT * 3;

/**
 * The unlock path: each perk as a large card in a horizontal rail, the next
 * one to unlock highlighted. Shown right under the hero so the student sees
 * what collecting gets them before they browse the collection.
 */
export function PerkList({ perks, power }: { perks: SpiritPerk[]; power: number }) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.round(width * 0.78);
  const unlocked = perks.filter((p) => p.unlocked).length;
  const nextKey = perks.find((p) => !p.unlocked)?.key;
  return (
    <View className="gap-3">
      <Text className="text-sm font-semibold text-muted-foreground">
        {t("{count} of {total} unlocked", { count: unlocked, total: perks.length })}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth + CARD_GAP}
        contentContainerStyle={{ gap: CARD_GAP, paddingHorizontal: GUTTER }}
        style={{ marginHorizontal: -GUTTER }}
      >
        {perks.map((perk) => (
          <PerkCard
            key={perk.key}
            perk={perk}
            power={power}
            width={cardWidth}
            isNext={perk.key === nextKey}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function PerkCard({
  perk,
  power,
  width,
  isNext,
}: {
  perk: SpiritPerk;
  power: number;
  width: number;
  isNext: boolean;
}) {
  const copy = PERK_COPY[perk.key];
  const Icon = PERK_ICON[perk.key as keyof typeof PERK_ICON] ?? Sparkles;
  const progress = perkProgress(perk, power);
  const highlighted = perk.unlocked || isNext;
  return (
    <View
      style={{ width }}
      className={
        perk.unlocked
          ? "gap-4 rounded-3xl border border-primary/50 bg-primary/10 p-5"
          : isNext
            ? "gap-4 rounded-3xl border border-primary/30 bg-card p-5"
            : "gap-4 rounded-3xl border border-dashed border-border bg-card p-5"
      }
    >
      <View className="flex-row items-start justify-between gap-3">
        <View
          className={
            highlighted
              ? "h-14 w-14 items-center justify-center rounded-2xl bg-primary"
              : "h-14 w-14 items-center justify-center rounded-2xl bg-muted"
          }
        >
          {highlighted ? (
            <Icon size={26} className="text-primary-foreground" />
          ) : (
            <Lock size={22} className="text-muted-foreground" />
          )}
        </View>
        <View
          className={
            perk.unlocked || isNext
              ? "flex-row items-center gap-1 rounded-full bg-primary px-3 py-1.5"
              : "flex-row items-center gap-1 rounded-full bg-muted px-3 py-1.5"
          }
        >
          {perk.unlocked ? <Check size={12} className="text-primary-foreground" /> : null}
          <Text
            className={
              perk.unlocked || isNext
                ? "text-xs font-bold text-primary-foreground"
                : "text-xs font-semibold text-muted-foreground"
            }
          >
            {perk.unlocked
              ? t("Unlocked")
              : isNext
                ? t("Next unlock")
                : t("Unlocks at {power} power", { power: perk.power })}
          </Text>
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-[18px] font-bold" numberOfLines={1}>
          {copy ? t(copy.title) : t("Zendeck perk")}
        </Text>
        <Text
          className="text-sm text-muted-foreground"
          numberOfLines={3}
          style={{ lineHeight: LINE_HEIGHT, height: DESCRIPTION_HEIGHT }}
        >
          {copy ? t(copy.description) : t("Details for this perk are not available yet.")}
        </Text>
      </View>

      <View className="gap-2">
        <View className="h-1.5 overflow-hidden rounded-full bg-muted">
          <View
            className={perk.unlocked ? "h-full rounded-full bg-primary" : "h-full rounded-full bg-primary/60"}
            style={{ width: `${progress * 100}%` }}
          />
        </View>
        <View className="flex-row items-center justify-between">
          <Text className="text-xs text-muted-foreground">
            {t("{current} of {threshold} power", {
              current: Math.min(power, perk.power),
              threshold: perk.power,
            })}
          </Text>
          <Text className="text-xs font-semibold text-muted-foreground">{t("Coming soon")}</Text>
        </View>
      </View>
    </View>
  );
}
