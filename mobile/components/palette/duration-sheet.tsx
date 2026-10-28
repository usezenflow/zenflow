import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";

const ROW = 46;
const ROWS = 7;
const HOURS = Array.from({ length: 13 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

/** One wheel: snaps to a row, the centre row is the pick. Same on iOS and Android. */
function Wheel({
  values,
  index,
  onChange,
  unit,
}: {
  values: number[];
  index: number;
  onChange: (i: number) => void;
  unit: string;
}) {
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [at, setAt] = useState(index);
  useEffect(() => {
    const id = setTimeout(
      () => ref.current?.scrollTo({ y: index * ROW, animated: false }),
      0,
    );
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <View className="flex-row items-center" style={{ height: ROW * ROWS }}>
      <ScrollView
        ref={ref}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        style={{ width: 64 }}
        contentContainerStyle={{ paddingVertical: ROW * ((ROWS - 1) / 2) }}
        onScroll={(e) => {
          const i = Math.max(
            0,
            Math.min(
              values.length - 1,
              Math.round(e.nativeEvent.contentOffset.y / ROW),
            ),
          );
          if (i !== at) {
            setAt(i);
            void Haptics.selectionAsync();
          }
        }}
        scrollEventThrottle={16}
        onMomentumScrollEnd={() => onChange(at)}
        onScrollEndDrag={() => onChange(at)}
      >
        {values.map((v, i) => (
          <View
            key={v}
            style={{ height: ROW }}
            className="items-center justify-center"
          >
            <Text
              className={
                i === at
                  ? "text-[24px] font-extrabold"
                  : "text-[18px] text-muted-foreground"
              }
              style={{
                opacity:
                  i === at ? 1 : Math.max(0.3, 1 - Math.abs(i - at) * 0.3),
              }}
            >
              {v}
            </Text>
          </View>
        ))}
      </ScrollView>
      <Text className="w-12 text-[14px] font-bold">{unit}</Text>
    </View>
  );
}

/** Hours 0 to 12 and minutes 0, 15, 30, 45 on two wheels, inline in the panel so the rest of the screen stays usable. */
export function DurationSheet({
  initial = 60,
  onDone,
  onClose,
}: {
  initial?: number;
  onDone: (minutes: number) => void;
  onClose: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const [h, setH] = useState(Math.min(12, Math.floor(initial / 60)));
  const [m, setM] = useState(
    Math.max(0, MINUTES.indexOf(Math.round((initial % 60) / 15) * 15)),
  );
  const total = h * 60 + MINUTES[m];
  return (
    <View testID="duration-sheet" className="px-3 pb-2 pt-1">
      <View className="flex-row items-center justify-between">
        <Pressable onPress={onClose} hitSlop={10}>
          <Text className="text-[15px] text-muted-foreground">
            {t("Cancel")}
          </Text>
        </Pressable>
        <Text className="text-[16px] font-bold">{t("Duration")}</Text>
        <Pressable
          testID="duration-done"
          disabled={total < 15}
          onPress={() => onDone(total)}
          hitSlop={10}
          style={{ opacity: total < 15 ? 0.4 : 1 }}
        >
          <Text className="text-[15px] font-bold" style={{ color: c.orange }}>
            {t("Done")}
          </Text>
        </Pressable>
      </View>
      <View className="mt-3 justify-center">
        <View
          pointerEvents="none"
          className="absolute inset-x-0 rounded-xl bg-muted"
          style={{ height: ROW, top: ROW * ((ROWS - 1) / 2) }}
        />
        <View className="flex-row justify-center" style={{ gap: 16 }}>
          <Wheel values={HOURS} index={h} onChange={setH} unit={t("hours")} />
          <Wheel
            values={MINUTES}
            index={m}
            onChange={setM}
            unit={t("minutes")}
          />
        </View>
      </View>
    </View>
  );
}
