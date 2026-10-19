import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { View } from "react-native";

/** Shown in place of the map when no map edge is configured. */
export function CampusMapUnavailable() {
  return (
    <View testID="campus-map-unavailable" className="h-[80px] items-center justify-center rounded-xl bg-glass/60">
      <Text className="text-[13px] text-muted-foreground">{t("Map unavailable")}</Text>
    </View>
  );
}
