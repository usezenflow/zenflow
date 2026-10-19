import { Sparkles, Sprout, Star } from "@/components/Icons";
import { OfflineIndicator } from "@/components/offline-indicator";
import { CollectionGrid } from "@/components/spirits/collection-grid";
import { CompanionCard } from "@/components/spirits/companion-card";
import { HatchMoment } from "@/components/spirits/hatch-moment";
import { PerkList } from "@/components/spirits/perk-list";
import { SpiritHero } from "@/components/spirits/spirit-hero";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useSpiritsStore } from "@/hooks/use-spirits";
import { t } from "@/lib/i18n";
import { equippedSpiritId, isSpiritId } from "@/lib/spirit-collection";
import { useTabBarOverlayHeight } from "@/lib/tab-bar-metrics";
import type { SpiritRarity } from "@zenflow/shared";
import { SPIRITS, type SpiritId } from "@zenflow/spirits";
import { useFocusEffect } from "expo-router";
import { useCallback, useState, type ReactNode } from "react";
import { ScrollView, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Content gutter, the same as the profile screen. */
const GUTTER = 20;
const GAP = 12;

/**
 * The Zendeck tab. The hero says what to do next, perks show the road ahead,
 * the companion shows an ability, and the collection shows every spirit the
 * student has hatched or is still working toward.
 */
export default function ZendeckScreen() {
  useLanguage();
  const insets = useSafeAreaInsets();
  const tabBarOverlay = useTabBarOverlayHeight();
  const { width } = useWindowDimensions();
  const tile = (width - GUTTER * 2 - GAP) / 2;

  const data = useSpiritsStore((s) => s.data);
  const load = useSpiritsStore((s) => s.load);
  const hatch = useSpiritsStore((s) => s.hatch);
  const [viewing, setViewing] = useState<SpiritId | null>(null);
  const [hatching, setHatching] = useState(false);
  const [hatchFailed, setHatchFailed] = useState(false);
  const [revealed, setRevealed] = useState<{ spiritId: SpiritId; rarity: SpiritRarity } | null>(
    null,
  );

  // Sparks settle server side while the tab stays mounted, so reload on every focus.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const collection = data?.collection ?? [];
  const companion = equippedSpiritId(collection);
  const shown = viewing ?? companion;
  const shownSpirit = SPIRITS.find((s) => s.id === shown);
  const shownCount = collection.find((c) => c.spiritId === shown)?.count ?? 0;

  async function onHatch() {
    setHatching(true);
    setHatchFailed(false);
    try {
      const result = await hatch();
      if (isSpiritId(result.spirit.spiritId)) {
        setRevealed({ spiritId: result.spirit.spiritId, rarity: result.spirit.rarity });
      }
    } catch {
      setHatchFailed(true);
    } finally {
      setHatching(false);
    }
  }

  function onSelect(id: string) {
    if (isSpiritId(id)) setViewing(id);
  }

  return (
    <View className="flex-1 bg-background">
      <View
        className="border-b border-border bg-background px-6 pb-4"
        style={{ paddingTop: insets.top + 16 }}
      >
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold tracking-tight">{t("Zendeck")}</Text>
          <OfflineIndicator dayKey="zendeck" />
        </View>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          paddingHorizontal: GUTTER,
          paddingTop: 20,
          paddingBottom: tabBarOverlay + 24,
          gap: 28,
        }}
      >
        {data ? (
          <SpiritHero
            data={data}
            companion={companion}
            hatching={hatching}
            failed={hatchFailed}
            onHatch={onHatch}
          />
        ) : (
          <View className="h-60 rounded-[28px] bg-muted" />
        )}

        {data ? (
          <Section
            icon={<Star size={18} className="text-primary" />}
            title={t("Unlock path")}
            hint={t("Each perk unlocks as your power grows.")}
          >
            <PerkList perks={data.perks} power={data.power} />
          </Section>
        ) : null}

        {shownSpirit ? (
          <CompanionCard
            spiritId={shownSpirit.id}
            en={shownSpirit.en}
            rarity={shownSpirit.rarity}
            owned={shownCount > 0}
          />
        ) : null}

        {data ? (
          <Section
            icon={<Sparkles size={18} className="text-primary" />}
            title={t("Collection")}
            hint={t("Tap a spirit to see its ability.")}
          >
            <CollectionGrid
              collection={collection}
              tileSize={tile}
              selectedId={shown}
              onSelect={onSelect}
            />
          </Section>
        ) : null}

        <View className="flex-row items-center gap-3 rounded-3xl bg-card p-4">
          <Sprout size={22} className="text-primary" />
          <Text className="flex-1 text-sm text-muted-foreground">
            {t("Every start counts. Your spirits grow with you.")}
          </Text>
        </View>
      </ScrollView>

      {revealed ? (
        <HatchMoment
          spiritId={revealed.spiritId}
          rarity={revealed.rarity}
          onClose={() => setRevealed(null)}
        />
      ) : null}
    </View>
  );
}

function Section({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2">
        {icon}
        <Text className="text-[17px] font-bold">{title}</Text>
      </View>
      {hint ? <Text className="text-sm text-muted-foreground">{hint}</Text> : null}
      {children}
    </View>
  );
}
