import { Settings } from "@/components/Icons";
import { Logo } from "@/components/logo";
import { Text } from "@/components/ui/text";
import { format, t } from "@/lib/i18n";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { useRouter } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

function greeting(now: Date) {
  const h = now.getHours();
  return h < 12
    ? t("Good morning")
    : h < 18
      ? t("Good afternoon")
      : t("Good evening");
}

/** Orange sunrise glow behind the top of every palette screen. */
export function Glow() {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  return (
    <View
      pointerEvents="none"
      className="absolute inset-x-0 top-0"
      style={{ height: 460 }}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient
            id="glow"
            cx="50%"
            cy="-4%"
            rx="85%"
            ry="62%"
            fx="50%"
            fy="-4%"
          >
            <Stop offset="0" stopColor={c.glowTop} />
            <Stop offset="0.48" stopColor={c.glowMid} />
            <Stop offset="0.72" stopColor={c.glowMid} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#glow)" />
      </Svg>
    </View>
  );
}

/**
 * Screen frame: glow, settings cog and, for an empty field, the greeting above the pill.
 * The pill stays in one place in the tree so typing never remounts it.
 */
export function HomeShell({
  empty,
  left,
  pill,
  overlay,
  panel,
  children,
}: {
  empty: boolean;
  left: number | null;
  pill: ReactNode;
  overlay?: ReactNode;
  /** Menus and lists under the pill. They float over everything below it instead of pushing it down. */
  panel?: ReactNode;
  children?: ReactNode;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [below, setBelow] = useState(0);
  const [kb, setKb] = useState(0);
  useEffect(() => {
    const ios = Platform.OS === "ios";
    const show = Keyboard.addListener(
      ios ? "keyboardWillShow" : "keyboardDidShow",
      (e) => setKb(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      ios ? "keyboardWillHide" : "keyboardDidHide",
      () => setKb(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const now = new Date();
  const sub = format(now, "EEEE d/M");
  const settings = (
        <Pressable
          testID="palette-settings"
          accessibilityRole="link"
          accessibilityLabel={t("Settings")}
          onPress={() => router.push("/(app)/settings")}
          hitSlop={12}
          className={`flex-row items-center justify-center gap-1.5 ${empty ? "absolute inset-x-0" : "mt-6"}`}
          style={empty ? { bottom: insets.bottom + 14 } : undefined}
        >
          <Settings size={14} className="text-muted-foreground" />
          <Text className="text-[13px] text-muted-foreground">
            {t("Settings")}
          </Text>
        </Pressable>
  );
  return (
    <View className="flex-1 bg-background">
      <Glow />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: empty ? "center" : "flex-start",
          paddingTop: insets.top + (empty ? 0 : 12),
          paddingBottom: empty ? Math.max(96, kb) : 32,
        }}
      >
        <Pressable
          accessible={false}
          style={StyleSheet.absoluteFill}
          onPress={Keyboard.dismiss}
        />
        <View
          onLayout={(e) =>
            setBelow(e.nativeEvent.layout.y + e.nativeEvent.layout.height)
          }
        >
        {empty && (
          <View className="mb-7 items-center px-8">
            <Logo className="mb-3 size-[46px]" />
            <Text className="text-[26px] font-bold tracking-[-0.5px]">
              {greeting(now)}
            </Text>
            <Text className="mt-1 text-[14px] text-muted-foreground">
              {left === null
                ? sub
                : `${sub}. ${t("{n} tasks left today", { n: left })}`}
            </Text>
          </View>
        )}
        {pill}
        {empty && (
          <Text className="mt-6 text-center text-[12.5px] text-muted-foreground">
            {t("Try: math 2h before friday")}
          </Text>
        )}
        </View>
        {children}
      </ScrollView>
      <View
        pointerEvents="box-none"
        className="absolute inset-x-0 z-10"
        style={{ top: below }}
      >
        {panel}
      </View>
      {overlay}
      {empty && settings}
    </View>
  );
}
