import { Text } from "@/components/ui/text";
import { format, t } from "@/lib/i18n";
import { MAX_DEADLINE_MONTHS } from "@/lib/palette/clash";
import { paletteColors } from "@/lib/palette/theme";
import { compose, earliestOn, monthGrid } from "@/lib/palette/when";
import { useColorScheme } from "@/lib/useColorScheme";
import * as Haptics from "expo-haptics";
import {
  addDays,
  addMonths,
  isSameDay,
  startOfDay,
  startOfMonth,
} from "date-fns";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { Ico } from "./icons";

const TIMES = [
  ["Morning", 9 * 60],
  ["Afternoon", 14 * 60],
  ["Evening", 19 * 60],
] as const;
const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

/** One sheet for day and time. Nothing before `min` can be picked. */
export function WhenSheet({
  title,
  min,
  initial,
  onDone,
  onClose,
}: {
  title: string;
  min: Date;
  initial?: Date;
  onDone: (d: Date) => void;
  onClose: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const [day, setDay] = useState(
    startOfDay(initial && initial > min ? initial : min),
  );
  const [minutes, setMinutes] = useState(
    initial && initial > min
      ? initial.getHours() * 60 + initial.getMinutes()
      : Math.max(9 * 60, earliestOn(day, min)),
  );
  const [month, setMonth] = useState(startOfMonth(day));
  const max = addMonths(min, MAX_DEADLINE_MONTHS);
  const at = compose(day, minutes, min);
  const floor = earliestOn(day, min);
  const quick = [
    t("Today"),
    t("Tomorrow"),
    format(addDays(min, 2), "EEE"),
    t("Next week"),
  ];
  const quickDays = [
    startOfDay(min),
    addDays(startOfDay(min), 1),
    addDays(startOfDay(min), 2),
    addDays(startOfDay(min), 7),
  ];
  const pickDay = (d: Date) => {
    void Haptics.selectionAsync();
    setDay(d);
    setMonth(startOfMonth(d));
    setMinutes((m) => Math.max(m, earliestOn(d, min)));
  };
  const step = (delta: number) =>
    setMinutes((m) => Math.min(23 * 60 + 45, Math.max(floor, m + delta)));
  const hm = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View testID="when-sheet" className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/35" onPress={onClose} />
        <View className="rounded-t-[28px] bg-background px-5 pb-9 pt-3">
          <View className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted" />
          <Text className="mb-3 text-[17px] font-bold">{title}</Text>
          <View className="mb-3 flex-row gap-2">
            {quick.map((q, i) => (
              <Pressable
                key={q}
                onPress={() => pickDay(quickDays[i])}
                className={`flex-1 items-center rounded-2xl py-2.5 ${isSameDay(day, quickDays[i]) ? "" : "bg-muted"}`}
                style={
                  isSameDay(day, quickDays[i])
                    ? { backgroundColor: c.orange }
                    : undefined
                }
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={
                    isSameDay(day, quickDays[i]) ? { color: c.ink } : undefined
                  }
                >
                  {q}
                </Text>
              </Pressable>
            ))}
          </View>
          <View className="rounded-3xl border border-border bg-card p-3">
            <View className="mb-2 flex-row items-center justify-between">
              <Pressable
                accessibilityLabel={t("Previous month")}
                disabled={month <= startOfMonth(min)}
                onPress={() => setMonth(addMonths(month, -1))}
                className="size-9 items-center justify-center rounded-full bg-muted"
                style={{ opacity: month <= startOfMonth(min) ? 0.35 : 1 }}
              >
                <View style={{ transform: [{ rotate: "180deg" }] }}>
                  <Ico name="arrow" size={16} color={c.orange} />
                </View>
              </Pressable>
              <Text className="text-[15px] font-bold">
                {format(month, "LLLL yyyy")}
              </Text>
              <Pressable
                accessibilityLabel={t("Next month")}
                disabled={addMonths(month, 1) > max}
                onPress={() => setMonth(addMonths(month, 1))}
                className="size-9 items-center justify-center rounded-full bg-muted"
                style={{ opacity: addMonths(month, 1) > max ? 0.35 : 1 }}
              >
                <Ico name="arrow" size={16} color={c.orange} />
              </Pressable>
            </View>
            <View className="flex-row flex-wrap">
              {WEEKDAYS.map((w, i) => (
                <Text
                  key={i}
                  className="w-[14.285%] pb-1 text-center text-[11px] font-semibold text-muted-foreground"
                >
                  {w}
                </Text>
              ))}
              {monthGrid(month, min, max).map((cell, i) => {
                const on = !!cell.date && isSameDay(cell.date, day);
                const today = !!cell.date && isSameDay(cell.date, new Date());
                return (
                  <View
                    key={i}
                    className="h-10 w-[14.285%] items-center justify-center"
                  >
                    {cell.date && (
                      <Pressable
                        testID={`when-day-${cell.date.getDate()}`}
                        disabled={cell.disabled}
                        onPress={() => pickDay(cell.date!)}
                        className="size-9 items-center justify-center rounded-full"
                        style={{
                          backgroundColor: on ? c.orange : undefined,
                          borderWidth: today && !on ? 1.5 : 0,
                          borderColor: c.orange,
                          opacity: cell.disabled ? 0.28 : 1,
                        }}
                      >
                        <Text
                          className="text-[14px] font-semibold"
                          style={on ? { color: c.ink } : undefined}
                        >
                          {cell.date.getDate()}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
          <View className="mt-3 flex-row items-center gap-2">
            {TIMES.map(([label, m]) => (
              <Pressable
                key={label}
                disabled={m < floor}
                onPress={() => setMinutes(m)}
                className={`rounded-full px-3.5 py-2 ${minutes === m ? "" : "bg-muted"}`}
                style={{
                  opacity: m < floor ? 0.3 : 1,
                  backgroundColor: minutes === m ? c.orange : undefined,
                }}
              >
                <Text
                  className="text-[13px] font-semibold"
                  style={minutes === m ? { color: c.ink } : undefined}
                >
                  {t(label)}
                </Text>
              </Pressable>
            ))}
            <View className="ml-auto flex-row items-center gap-1">
              <Pressable
                onPress={() => step(-15)}
                className="size-9 items-center justify-center rounded-full bg-muted"
              >
                <Text className="text-[18px] font-bold">-</Text>
              </Pressable>
              <Text className="w-[54px] text-center text-[17px] font-bold">
                {hm}
              </Text>
              <Pressable
                onPress={() => step(15)}
                className="size-9 items-center justify-center rounded-full bg-muted"
              >
                <Text className="text-[18px] font-bold">+</Text>
              </Pressable>
            </View>
          </View>
          <Pressable
            testID="when-done"
            onPress={() => onDone(at)}
            className="mt-4 items-center rounded-full py-3.5"
            style={{ backgroundColor: c.orange }}
          >
            <Text
              className="text-[16px] font-bold"
              style={{ color: c.ink }}
            >{`${t("Done")}: ${format(at, "EEE d/M, HH:mm")}`}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
