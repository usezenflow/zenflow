import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { LinearGradient } from "expo-linear-gradient";
import { Modal, Pressable, View } from "react-native";
import Svg, { Defs, Pattern, Rect } from "react-native-svg";
import { Ico } from "./icons";

const h = (m: number) =>
  m % 60
    ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}`
    : `${m / 60}h`;

/** The length does not fit before the deadline: shrink it to what is free, or keep the field and decide later. */
export function SprintSheet({
  need,
  left,
  onSprint,
  onLater,
}: {
  need: number;
  left: number;
  onSprint: () => void;
  onLater: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const ratio = Math.max(0.04, Math.min(1, left / need));
  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={onLater}
      statusBarTranslucent
    >
      <View testID="sprint-sheet" className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/35" onPress={onLater} />
        <View className="rounded-t-[28px] border-t border-border bg-background px-5 pb-9 pt-5">
          <LinearGradient
            colors={[c.orange, "#E5484D"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              alignSelf: "center",
              marginTop: -48,
              width: 64,
              height: 64,
              borderRadius: 32,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ico name="flame" size={30} color={c.ink} />
          </LinearGradient>
          <Text className="mt-3 text-center text-[18px] font-bold">
            {t("Easy, that is tight")}
          </Text>
          <Text className="mt-1 text-center text-[13.5px] text-muted-foreground">
            {t("Sprint to make the deadline? I will shrink it to fit.")}
          </Text>
          <View className="mt-4 rounded-2xl border border-border bg-card p-3">
            <View className="flex-row justify-between">
              <Text className="text-[12.5px] font-semibold">
                {t("Needs {time}", { time: h(need) })}
              </Text>
              <Text className="text-[12.5px] font-semibold text-muted-foreground">
                {t("{n} left", { n: h(left) })}
              </Text>
            </View>
            <View className="mt-2 h-3 flex-row overflow-hidden rounded-full bg-muted">
              <LinearGradient
                colors={[c.orange, c.yellow]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{ width: `${ratio * 100}%` }}
              />
              <Svg style={{ flex: 1 }} height={12} opacity={0.85}>
                <Defs>
                  <Pattern
                    id="short"
                    patternUnits="userSpaceOnUse"
                    width={9}
                    height={9}
                    patternTransform="rotate(135)"
                  >
                    <Rect width={5} height={9} fill={c.danger} />
                  </Pattern>
                </Defs>
                <Rect width="100%" height={12} fill="url(#short)" />
              </Svg>
            </View>
            <Text className="mt-1.5 text-[12px] text-muted-foreground">
              {t("{n} short", { n: h(Math.max(0, need - left)) })}
            </Text>
          </View>
          <View className="mt-4" style={{ gap: 8 }}>
            <Pressable
              testID="sprint-go"
              onPress={onSprint}
              className="h-12 flex-row items-center justify-center gap-2 rounded-xl bg-primary"
              style={{
                shadowColor: c.orange,
                shadowOpacity: 0.5,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 8 },
              }}
            >
              <Ico name="flame" size={18} color={c.ink} />
              <Text className="text-[14px] font-bold" style={{ color: c.ink }}>
                {t("Sprint")}
              </Text>
            </Pressable>
            <Pressable
              testID="sprint-later"
              onPress={onLater}
              className="h-11 flex-row items-center justify-center rounded-xl border border-border bg-card"
            >
              <Text className="text-[14px] font-semibold text-muted-foreground">
                {t("Later")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
