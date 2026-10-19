import { Crown, Gem, Sprout, Star } from "@/components/Icons";
import { SpiritTile } from "@/components/spirits/spirit-tile";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { RARITY_GLOW, RARITY_LABEL, RARITY_ORDER, groupByRarity } from "@/lib/spirit-collection";
import { tierCount } from "@/lib/spirit-motivation";
import type { SpiritCollectionEntry, SpiritRarity } from "@zenflow/shared";
import { View } from "react-native";

const TIER_ICON = { common: Sprout, rare: Star, epic: Gem, legendary: Crown } as const;
const GAP = 12;

/** Per-tier counts, then every spirit in one two-column grid, so no row is left half empty. */
export function CollectionGrid({
  collection,
  tileSize,
  selectedId,
  onSelect,
}: {
  collection: SpiritCollectionEntry[];
  tileSize: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const entries = groupByRarity(collection).flatMap((group) => group.entries);
  return (
    <View className="gap-4">
      <View className="flex-row flex-wrap gap-2">
        {RARITY_ORDER.map((rarity) => (
          <TierChip key={rarity} rarity={rarity} collection={collection} />
        ))}
      </View>
      <View className="flex-row flex-wrap" style={{ gap: GAP }}>
        {entries.map(({ spirit, count }) => (
          <SpiritTile
            key={spirit.id}
            spirit={spirit}
            count={count}
            size={tileSize}
            selected={selectedId === spirit.id}
            onPress={() => onSelect(spirit.id)}
          />
        ))}
      </View>
    </View>
  );
}

function TierChip({ rarity, collection }: { rarity: SpiritRarity; collection: SpiritCollectionEntry[] }) {
  const glow = RARITY_GLOW[rarity];
  const Icon = TIER_ICON[rarity];
  const { owned, total } = tierCount(collection, rarity);
  return (
    <View
      className="flex-row items-center gap-2 rounded-full bg-card px-3 py-2"
      style={{ borderWidth: 1, borderColor: `${glow}66` }}
    >
      <Icon size={14} color={glow} />
      <Text className="text-xs font-semibold">{t(RARITY_LABEL[rarity])}</Text>
      <Text className="text-xs text-muted-foreground">{t("{count} of {total}", { count: owned, total })}</Text>
    </View>
  );
}
