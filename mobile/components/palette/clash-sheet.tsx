import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import type { Clash } from "@/lib/palette/clash";
import { MAX_DEADLINE_MONTHS } from "@/lib/palette/clash";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { Modal, Pressable, View } from "react-native";

type Keep = "nudge" | "end" | "start" | "repeat" | "split";

const COPY: Record<Clash, { title: string; sub: string; options: [Keep, string][] }> = {
  far: {
    title: "That is a long way off",
    sub: "Deadlines go up to {n} months out.",
    options: [["nudge", "Set to {n} months"]],
  },
  repeatSplit: {
    title: "Repeat or split?",
    sub: "A task cannot do both.",
    options: [
      ["repeat", "Repeat it"],
      ["split", "Split into blocks"],
    ],
  },
  endBeforeStart: {
    title: "Which one did you mean?",
    sub: "The end comes before the start.",
    options: [
      ["end", "Keep the end"],
      ["start", "Keep the start"],
    ],
  },
};

/** One line asks for two things that cannot both hold: the user picks which to keep, or goes back and edits. */
export function ClashSheet({
  clash,
  onKeep,
  onClose,
}: {
  clash: Clash;
  onKeep: (keep: Keep) => void;
  onClose: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const copy = COPY[clash];
  const n = { n: MAX_DEADLINE_MONTHS };
  return (
    <Modal
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View testID="clash-sheet" className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/35" onPress={onClose} />
        <View className="rounded-t-[28px] border-t border-border bg-background px-5 pb-9 pt-5">
          <Text className="text-center text-[18px] font-bold">
            {t(copy.title)}
          </Text>
          <Text className="mt-1 text-center text-[13.5px] text-muted-foreground">
            {t(copy.sub, n)}
          </Text>
          <View className="mt-4" style={{ gap: 8 }}>
            {copy.options.map(([keep, label]) => (
              <Pressable
                key={keep}
                testID={`clash-${keep}`}
                onPress={() => onKeep(keep)}
                className="h-12 items-center justify-center rounded-xl bg-primary"
              >
                <Text className="text-[14px] font-bold" style={{ color: c.ink }}>
                  {t(label, n)}
                </Text>
              </Pressable>
            ))}
            <Pressable
              testID="clash-edit"
              onPress={onClose}
              className="h-11 items-center justify-center rounded-xl border border-border bg-card"
            >
              <Text className="text-[14px] font-semibold text-muted-foreground">
                {t("Edit the line")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
