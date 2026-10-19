import { SpiritArt } from "@/components/spirits/spirit-art";
import { Lock } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { RARITY_GLOW, RARITY_LABEL } from "@/lib/spirit-collection";
import type { Spirit } from "@zenflow/spirits";
import { Pressable, View } from "react-native";

/** A collection tile. Owned spirits glow in their rarity colour; unowned ones stay silhouettes. */
export function SpiritTile({
  spirit,
  count,
  selected,
  size,
  onPress,
}: {
  spirit: Spirit;
  count: number;
  selected: boolean;
  size: number;
  onPress: () => void;
}) {
  const glow = RARITY_GLOW[spirit.rarity];
  const art = size - 20;

  if (count === 0) {
    return (
      <View
        accessible
        accessibilityLabel={t("Locked spirit")}
        className="items-center justify-center rounded-3xl border border-dashed border-border bg-muted/40"
        style={{ width: size, height: size + 36 }}
      >
        <View style={{ opacity: 0.5 }}>
          <SpiritArt id={spirit.id} mood="locked" size={art * 0.7} />
        </View>
        <View className="absolute right-2 top-2 h-7 w-7 items-center justify-center rounded-full bg-background">
          <Lock size={14} className="text-muted-foreground" />
        </View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={t(spirit.en)}
      accessibilityState={{ selected }}
      className="items-center rounded-3xl bg-card p-2"
      style={{
        width: size,
        borderWidth: 2,
        borderColor: selected ? glow : "transparent",
      }}
    >
      <View
        className="items-center justify-center rounded-2xl"
        style={{ width: art, height: art, backgroundColor: `${glow}22` }}
      >
        <SpiritArt id={spirit.id} size={art * 0.84} />
      </View>
      <Text className="mt-2 text-[14px] font-semibold" numberOfLines={1}>
        {t(spirit.en)}
      </Text>
      <View className="mt-1 flex-row items-center gap-1.5">
        <View className="h-2 w-2 rounded-full" style={{ backgroundColor: glow }} />
        <Text className="text-xs text-muted-foreground">{t(RARITY_LABEL[spirit.rarity])}</Text>
        {count > 1 ? <Text className="text-xs font-semibold text-primary">×{count}</Text> : null}
      </View>
    </Pressable>
  );
}
