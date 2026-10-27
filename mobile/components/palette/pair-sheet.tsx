import { slotPick } from "@/api/tasks";
import { CurveSwirl } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { format, t } from "@/lib/i18n";
import type { PairOffer } from "@/lib/palette/gate";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { addMinutes } from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import { useMemo, useState } from "react";
import { useEffect } from "react";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { Pressable, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Sheet } from "./result-panel";

const hm = (d: Date) => format(d, "HH:mm");
const dayLabel = (d: Date) => format(d, "EEEE d/M");

function Tile({
  label,
  at,
  minutes,
  state,
  primary,
  onPress,
  id,
}: {
  label: string;
  at: Date;
  minutes: number;
  state: "picked" | "faded";
  primary: boolean;
  onPress: () => void;
  id: string;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const pos = (at.getHours() * 60 + at.getMinutes()) / 1440;
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withSpring(state === "picked" ? -3 : 0, {
      damping: 14,
      stiffness: 180,
    });
  }, [state, lift]);
  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }],
  }));
  return (
    <Animated.View
      style={[{ flex: 1, opacity: state === "faded" ? 0.55 : 1 }, style]}
    >
      <Pressable testID={id} onPress={onPress}>
        <LinearGradient
          colors={primary ? ["#ff8e3e", "#F0B100"] : ["#F0B100", "#D8F999"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            borderRadius: 20,
            padding: 12,
            borderWidth: state === "picked" ? 3 : 0,
            borderColor: "rgba(43,20,6,0.8)",
            shadowColor: c.orange,
            shadowOpacity: state === "faded" ? 0 : 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
          }}
        >
          <View className="self-start rounded-full bg-white/70 px-2.5 py-0.5">
            <Text className="text-[11.5px] font-bold" style={{ color: c.ink }}>
              {label}
            </Text>
          </View>
          <View className="mt-2 flex-row items-baseline">
            <Text
              className="text-[26px] font-extrabold"
              style={{ color: c.ink }}
            >
              {hm(at)}
            </Text>
            <Text
              className="ml-1.5 text-[13px] font-semibold"
              style={{ color: c.ink }}
            >
              {`${t("to")} ${hm(addMinutes(at, minutes))}`}
            </Text>
          </View>
          <Text
            className="text-[12.5px] font-semibold"
            style={{ color: c.ink }}
          >
            {dayLabel(at)}
          </Text>
          <View className="mt-2 h-1.5 rounded-full bg-white/50">
            <View
              className="absolute size-2 rounded-full"
              style={{ left: `${pos * 94}%`, top: -1, backgroundColor: c.ink }}
            />
          </View>
          {state === "picked" && (
            <View
              className="absolute right-2 top-2 size-7 items-center justify-center rounded-full"
              style={{ backgroundColor: "#2B1406" }}
            >
              <Svg
                width={15}
                height={15}
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <Path d="M5 12.5l4.5 4.5L19 7" />
              </Svg>
            </View>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

/** Up to three items with two good times each. Policy stays hidden and the order is stable but arbitrary. */
export function PairSheet({
  offers,
  onClose,
}: {
  offers: PairOffer[];
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<
    Record<string, "primary" | "alternative">
  >({});
  const flip = useMemo(
    () =>
      Object.fromEntries(
        offers.map((o) => [o.id, o.id.charCodeAt(o.id.length - 1) % 2 === 1]),
      ),
    [offers],
  );
  const pick = (o: PairOffer, chose: "primary" | "alternative") => {
    setPicked((p) => ({ ...p, [o.id]: chose }));
    void slotPick(o.id, { slotProposalId: o.proposalId, chose }).catch(() =>
      setPicked(
        (p) =>
          Object.fromEntries(
            Object.entries(p).filter(([k]) => k !== o.id),
          ) as typeof p,
      ),
    );
  };
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  return (
    <Sheet testID="pair-sheet" still onClose={onClose}>
      <View className="mb-3 flex-row items-center gap-3">
        <View className="size-8">
          <CurveSwirl color={c.orange} animate={false} />
        </View>
        <View>
          <Text className="text-[20px] font-bold">
            {t("Which time suits you better?")}
          </Text>
          <Text className="text-[13px] text-muted-foreground">
            {t("Tap the time you like")}
          </Text>
        </View>
      </View>
      {offers.map((o) => {
        const tiles: ["primary" | "alternative", string, string][] = [
          ["primary", t("Placed time"), o.primary],
          ["alternative", t("Other time"), o.alternative],
        ];
        if (flip[o.id]) tiles.reverse();
        return (
          <View key={o.id} className="mb-3">
            <Text className="mb-1.5 text-[15px] font-bold">{o.title}</Text>
            <View className="flex-row gap-3">
              {tiles.map(([key, label, iso]) => (
                <Tile
                  key={key}
                  id={`pair-${o.id}-${key}`}
                  label={label}
                  at={new Date(iso)}
                  minutes={o.minutes}
                  primary={key === "primary"}
                  state={(picked[o.id] ?? "primary") === key ? "picked" : "faded"}
                  onPress={() => pick(o, key)}
                />
              ))}
            </View>
          </View>
        );
      })}
      <Button
        testID="pair-done"
        className="mt-1 h-14 rounded-[20px]"
        onPress={onClose}
      >
        <Text className="text-[16px] font-bold">{t("Done")}</Text>
      </Button>
    </Sheet>
  );
}
