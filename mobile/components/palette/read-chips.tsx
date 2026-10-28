import { Text } from "@/components/ui/text";
import { format, t, weekdayShort } from "@/lib/i18n";
import { addDays, startOfWeek } from "date-fns";
import { KIND_COLOR, tint } from "@/lib/palette/theme";
import type { Understood } from "@/lib/palette/understand";
import { Pressable, View } from "react-native";
import { Ico, type IconName } from "./icons";
import { minutesLabel } from "./menus";

const ICON: Record<string, IconName> = {
  length: "clock",
  clock: "clock",
  day: "flag",
  part: "moon",
};
const WINDOW = {
  MORNING: "Morning",
  AFTERNOON: "Afternoon",
  EVENING: "Evening",
} as const;
const COLOR = {
  ...KIND_COLOR,
  from: KIND_COLOR.repeat,
  split: KIND_COLOR.length,
} as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** "Every day", "Every week", "Every Mon". */
export function repeatLabel(u: Understood) {
  const r = u.repeat!;
  if (r.freq === "DAILY") return t("Every day");
  return r.days
    ? t("Every {day}", {
        day: weekdayShort(
          addDays(startOfWeek(new Date(), { weekStartsOn: 0 }), r.days[0]),
        ),
      })
    : t("Every week");
}

function labelOf(u: Understood, kind: string): string {
  if (kind === "place") return u.place!;
  if (kind === "split") return t("{n} blocks", { n: u.split! });
  if (kind === "repeat") return repeatLabel(u);
  if (kind === "from") {
    const d = u.from!.day ? format(u.from!.day, "EEE d/M") : "";
    const m = u.from!.time;
    return t("From {when}", {
      when: [d, m == null ? "" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`]
        .filter(Boolean)
        .join(" "),
    });
  }
  if (kind === "length") return minutesLabel(u.minutes!);
  if (kind === "day") return format(u.day!, "EEE d/M");
  if (kind === "clock")
    return `${pad(Math.floor(u.time! / 60))}:${pad(u.time! % 60)}`;
  return t(WINDOW[u.window!]);
}

/** What the last line was read as, under the pill. Tap a chip to keep its words in the title. */
export function ReadChips({
  u,
  onSkip,
}: {
  u: Understood;
  onSkip: (word: string) => void;
}) {
  if (!u.spans.length) return null;
  return (
    <View testID="read-chips" className="mx-5 mt-2.5 flex-row flex-wrap gap-2">
      {u.spans.map((s) => (
        <Pressable
          key={`${s.kind}-${s.start}`}
          testID={`read-chip-${s.kind}`}
          accessibilityLabel={`${labelOf(u, s.kind)}, ${t("Remove")}`}
          onPress={() => onSkip(s.word)}
          className="flex-row items-center gap-1 rounded-full px-3 py-1.5"
          style={{ backgroundColor: tint(COLOR[s.kind], 0.2) }}
        >
          <Ico name={ICON[s.kind]} size={13} color={COLOR[s.kind]} />
          <Text className="text-[14px] font-semibold">
            {labelOf(u, s.kind)}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
