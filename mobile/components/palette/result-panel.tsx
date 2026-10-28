import { Text } from "@/components/ui/text";
import { Glass } from "@/components/ui/glass";
import { paletteColors, tint } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import Animated, {
  useReducedMotion,
  FadeIn,
  FadeOut,
  SlideInDown,
} from "react-native-reanimated";
import { Ico, type IconName } from "./icons";

/** The floating list under the pill: verbs, suggestions, matches. */
export function ResultPanel({
  title,
  children,
  testID,
}: {
  title?: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      className="mx-4 mt-3"
      style={{
        borderRadius: 26,
        shadowColor: "#2A2218",
        shadowOpacity: 0.3,
        shadowRadius: 25,
        shadowOffset: { width: 0, height: 14 },
      }}
    >
      <Glass radius={26}>
        <View
          className="p-2"
          style={{
            borderWidth: 1,
            borderColor: "rgba(128,128,128,0.18)",
            borderRadius: 26,
          }}
        >
          {title ? (
            <Text className="px-3 pb-1 pt-1 text-[12px] font-semibold text-muted-foreground">
              {title}
            </Text>
          ) : null}
          {children}
        </View>
      </Glass>
    </View>
  );
}

/** One row: 36px icon tile, title (typed prefix in orange), muted subtitle. */
export function PanelRow({
  icon,
  title,
  sub,
  prefix = 0,
  selected = false,
  onPress,
  testID,
  disabled,
}: {
  icon: IconName;
  title: string;
  sub?: string;
  prefix?: number;
  selected?: boolean;
  onPress?: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      className={`flex-row items-center gap-3 rounded-2xl px-3 py-2 ${selected ? "bg-primary/10" : ""}`}
    >
      <View
        className="size-9 items-center justify-center rounded-[10px]"
        style={{
          backgroundColor: selected
            ? c.orange
            : tint(c.orange, isDarkColorScheme ? 0.28 : 0.16),
        }}
      >
        <Ico name={icon} size={20} color={selected ? c.ink : c.orange} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold" numberOfLines={1}>
          <Text className="text-[15px] font-semibold text-primary">
            {title.slice(0, prefix)}
          </Text>
          {title.slice(prefix)}
        </Text>
        {sub ? (
          <Text
            className="text-[12.5px] text-muted-foreground"
            numberOfLines={1}
          >
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** A completion chip: white pill, orange check icon. */
export function GhostChip({
  label,
  onPress,
  icon = "check",
  active = false,
}: {
  label: string;
  onPress: () => void;
  icon?: IconName;
  active?: boolean;
}) {
  const { isDarkColorScheme } = useColorScheme();
  return (
    <Pressable
      testID={`ghost-${label}`}
      onPress={onPress}
      className={`mr-2 flex-row items-center gap-1.5 rounded-full px-3.5 py-1.5 ${active ? "border border-primary/40 bg-primary/15" : "bg-card"}`}
      style={{
        shadowColor: "#000",
        shadowOpacity: 0.12,
        shadowRadius: 1,
        shadowOffset: { width: 0, height: 1 },
      }}
    >
      <Ico
        name={icon}
        size={16}
        color={paletteColors(isDarkColorScheme).orange}
      />
      <Text className="text-[15px] font-medium">{label}</Text>
    </Pressable>
  );
}

/** Bottom sheet: scrim, rounded top, grabber. Lives over the screen, not in the scroll. */
export function Sheet({
  children,
  onClose,
  testID,
  still = false,
}: {
  children: ReactNode;
  onClose: () => void;
  testID?: string;
  /** Fade in place instead of springing up, for sheets that appear unprompted. */
  still?: boolean;
}) {
  const reduce = useReducedMotion();
  return (
    <View testID={testID} className="absolute inset-0 z-20 justify-end">
      <Animated.View
        entering={reduce ? undefined : FadeIn}
        exiting={reduce ? undefined : FadeOut}
        className="absolute inset-0"
      >
        <Pressable
          testID="sheet-scrim"
          className="absolute inset-0 bg-black/35"
          onPress={onClose}
        />
      </Animated.View>
      <Animated.View
        entering={
          reduce ? undefined : still ? FadeIn : SlideInDown.springify().damping(22)
        }
        className="rounded-t-[32px] border-t border-border bg-card px-5 pb-10 pt-3"
        style={{
          shadowColor: "#2A2218",
          shadowOpacity: 0.4,
          shadowRadius: 25,
          shadowOffset: { width: 0, height: -14 },
        }}
      >
        <View className="mx-auto mb-4 h-1 w-10 rounded-full bg-muted-foreground/30" />
        {children}
      </Animated.View>
    </View>
  );
}
