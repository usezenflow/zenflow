import { Clock, Zap } from "@/components/Icons";
import { SpiritArt } from "@/components/spirits/spirit-art";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { ABILITIES, RARITY_GLOW, RARITY_LABEL } from "@/lib/spirit-collection";
import type { SpiritRarity } from "@zenflow/shared";
import type { SpiritId } from "@zenflow/spirits";
import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View } from "react-native";

/** The spirit the student is looking at (their companion by default), with its ability. */
export function CompanionCard({
  spiritId,
  en,
  rarity,
  owned,
}: {
  spiritId: SpiritId;
  en: string;
  rarity: SpiritRarity;
  owned: boolean;
}) {
  const glow = RARITY_GLOW[rarity];
  const ability = ABILITIES[spiritId];
  return (
    <View className="gap-4 overflow-hidden rounded-3xl bg-card p-5">
      <LinearGradient
        colors={[`${glow}33`, `${glow}00`]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View className="flex-row items-center gap-4">
        <SpiritArt id={spiritId} mood={owned ? "calm" : "locked"} size={108} />
        <View className="flex-1 gap-2">
          <Text className="text-xs font-semibold text-muted-foreground">{t("Companion")}</Text>
          <Text className="text-[20px] font-bold">{owned ? t(en) : t("Locked spirit")}</Text>
          <View className="flex-row items-center gap-2">
            <View className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: glow }} />
            <Text className="text-xs text-muted-foreground">{t(RARITY_LABEL[rarity])}</Text>
          </View>
        </View>
      </View>
      {owned ? (
        <View className="gap-2 rounded-2xl bg-background/70 p-4">
          <View className="flex-row items-center gap-2">
            <Zap size={16} color={glow} />
            <Text className="text-[15px] font-semibold">{t(ability.name)}</Text>
          </View>
          <Text className="text-sm text-muted-foreground">{t(ability.effect)}</Text>
          <View className="mt-1 flex-row items-center gap-1.5 self-start rounded-full bg-muted px-2.5 py-1">
            <Clock size={12} className="text-muted-foreground" />
            <Text className="text-xs font-semibold text-muted-foreground">{t("Coming soon")}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
