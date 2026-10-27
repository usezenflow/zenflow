import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import { UNDO_WINDOW_MS } from "@/lib/undo";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

const R = 11;
const C = 2 * Math.PI * R;

/** The commit toast of mockups/command-palette.html: a ring that drains over the undo window, the message and Undo. */
export function CommitToast({
  title,
  onUndo,
  onDone,
  ms = UNDO_WINDOW_MS,
}: {
  title: string;
  onUndo: () => void;
  onDone: () => void;
  ms?: number;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const [left, setLeft] = useState(1);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => {
      const f = 1 - (Date.now() - start) / ms;
      if (f <= 0) {
        clearInterval(timer);
        onDone();
      } else setLeft(f);
    }, 80);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms]);
  return (
    <View
      testID="commit-toast"
      className="absolute inset-x-4 bottom-8 z-30"
      style={{
        borderRadius: 16,
        shadowColor: "#000",
        shadowOpacity: 0.3,
        shadowRadius: 20,
        shadowOffset: { width: 0, height: 10 },
      }}
    >
      <Glass radius={16}>
        <View
          className="flex-row items-center gap-3 px-4 py-3.5"
          style={{
            borderWidth: 1,
            borderColor: `${c.orange}40`,
            borderRadius: 16,
          }}
        >
          <Svg width={28} height={28} viewBox="0 0 28 28" fill="none">
            <Circle
              cx={14}
              cy={14}
              r={R}
              stroke={c.orange}
              strokeOpacity={0.22}
              strokeWidth={2.4}
            />
            <Circle
              cx={14}
              cy={14}
              r={R}
              stroke={c.orange}
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeDasharray={`${C * left} ${C}`}
              rotation={-90}
              origin="14,14"
            />
            <Path
              d="M9.5 14.2l3 3 6-6.2"
              stroke={c.orange}
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </Svg>
          <Text
            className="min-w-0 flex-1 text-[15px] font-medium"
            numberOfLines={1}
          >
            {title}
          </Text>
          <Pressable testID="commit-undo" hitSlop={10} onPress={onUndo}>
            <Text className="text-[15px] font-bold" style={{ color: c.orange }}>
              {t("Undo")}
            </Text>
          </Pressable>
        </View>
      </Glass>
    </View>
  );
}
