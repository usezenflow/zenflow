import { Text } from "@/components/ui/text";
import { paletteColors, KIND_COLOR, tint } from "@/lib/palette/theme";
import type { Suggestion } from "@/lib/palette/home";
import { understand, type SpanKind } from "@/lib/palette/understand";
import { useColorScheme } from "@/lib/useColorScheme";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { Ico, type IconName } from "./icons";

const VERB_ICON: Record<NonNullable<Suggestion["verb"]>, IconName> = {
  replan: "wand",
  recap: "bars",
  free: "find",
};
const LOOK: Record<SpanKind, { icon: IconName; color: string }> = {
  place: { icon: "pin", color: KIND_COLOR.place },
  from: { icon: "calendar", color: KIND_COLOR.repeat },
  part: { icon: "moon", color: KIND_COLOR.part },
  clock: { icon: "clock", color: KIND_COLOR.clock },
  length: { icon: "clock", color: KIND_COLOR.length },
  day: { icon: "flag", color: KIND_COLOR.day },
  repeat: { icon: "replan", color: KIND_COLOR.repeat },
  split: { icon: "sliders", color: KIND_COLOR.length },
};
/** The chip takes the look of the rarest thing it teaches. */
const ORDER: SpanKind[] = [
  "repeat",
  "place",
  "from",
  "split",
  "part",
  "clock",
  "day",
  "length",
];

/** Tappable examples under the pill. Each shows, by colour and icon, what the field will read from it. */
export function StarterChips({
  cards,
  onPick,
}: {
  cards: Suggestion[];
  onPick: (card: Suggestion) => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const looks = useMemo(
    () =>
      cards.map((s) => {
        if (s.verb) return { icon: VERB_ICON[s.verb], color: c.orange };
        const kinds = new Set(
          understand(s.text, new Date()).spans.map((x) => x.kind),
        );
        const k = ORDER.find((o) => kinds.has(o));
        return k ? LOOK[k] : { icon: "plus" as IconName, color: c.orange };
      }),
    [cards, c.orange],
  );
  return (
    <View
      testID="starter-chips"
      className="mx-4 mt-6 flex-row flex-wrap justify-center gap-2.5"
    >
      {cards.map((s, i) => (
        <Pressable
          key={s.id}
          testID={`card-${s.id}`}
          onPress={() => onPick(s)}
          className="flex-row items-center gap-2 rounded-full bg-card py-1.5 pl-1.5 pr-4"
          style={{
            borderWidth: 1,
            borderColor: tint(looks[i].color, 0.45),
            shadowColor: looks[i].color,
            shadowOpacity: 0.22,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 2,
          }}
        >
          <View
            className="size-8 items-center justify-center rounded-full"
            style={{
              backgroundColor: tint(
                looks[i].color,
                isDarkColorScheme ? 0.3 : 0.2,
              ),
            }}
          >
            <Ico name={looks[i].icon} size={17} color={looks[i].color} />
          </View>
          <Text
            className="max-w-[260px] text-[14.5px] font-semibold"
            numberOfLines={1}
          >
            {s.text}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
