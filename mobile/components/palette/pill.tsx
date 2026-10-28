import { Glass } from "@/components/ui/glass";
import { CurveSwirl } from "@/components/ui/spinner";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, TextInput, View } from "react-native";
import { Text } from "@/components/ui/text";
import type { ReactNode } from "react";
import Svg, { Path } from "react-native-svg";

type Props = {
  value: string;
  placeholder: string;
  busy: boolean;
  canSend: boolean;
  onChangeText: (text: string) => void;
  onSend: () => void;
  onFocusChange: (focused: boolean) => void;
  /** Verb word shown as an orange badge before the text. */
  badge?: string | null;
  /** Chips (task, length, range) shown inline before the text. */
  chips?: ReactNode;
  /** Backspace pressed in an empty field: drops the badge. */
  onBackspaceEmpty?: () => void;
};

/** The glass pill of mockups/command-palette.html: swirl mark, free text, clear, send. */
export function Pill({
  value,
  placeholder,
  busy,
  canSend,
  onChangeText,
  onSend,
  onFocusChange,
  badge,
  chips,
  onBackspaceEmpty,
}: Props) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const stroke = (on: boolean) =>
    on ? c.ink : isDarkColorScheme ? "#B8AFA3" : "#6F665B";
  return (
    <View
      className="mx-4"
      style={{
        borderRadius: 34,
        borderWidth: 4,
        borderColor: c.ring,
        shadowColor: c.orange,
        shadowOpacity: 0.4,
        shadowRadius: 28,
        elevation: 8,
        shadowOffset: { width: 0, height: 10 },
      }}
    >
      <Glass radius={30}>
        <View
          className="flex-row items-start gap-3 px-4 py-3.5"
          style={{ borderWidth: 1, borderColor: c.edge, borderRadius: 30 }}
        >
          <View className="mt-[3px] size-6 shrink-0">
            <CurveSwirl color={c.orange} animate={busy} />
          </View>
          <View
            className="min-w-0 flex-1 flex-row flex-wrap items-center"
            style={{ rowGap: 4 }}
          >
            {badge ? (
              <LinearGradient
                testID="palette-badge"
                colors={[c.orange, c.yellow]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  marginRight: 8,
                  borderRadius: 8,
                  paddingHorizontal: 8,
                  paddingVertical: 1,
                }}
              >
                <Text
                  className="text-[15px] font-bold"
                  style={{ color: c.ink }}
                >
                  {badge}
                </Text>
              </LinearGradient>
            ) : null}
            {chips}
            <TextInput
              onKeyPress={(e) =>
                e.nativeEvent.key === "Backspace" &&
                value === "" &&
                onBackspaceEmpty?.()
              }
              testID="palette-input"
              multiline
              autoCorrect={false}
              spellCheck={false}
              autoCapitalize="none"
              value={value}
              onChangeText={onChangeText}
              onFocus={() => onFocusChange(true)}
              onBlur={() => onFocusChange(false)}
              placeholder={placeholder}
              placeholderTextColor={isDarkColorScheme ? "#B8AFA3" : "#6F665B"}
              selectionColor={c.orange}
              className="p-0 text-[17px] text-foreground"
              style={{ lineHeight: 27, flexGrow: 1, minWidth: 96 }}
            />
          </View>
          <View className="shrink-0 flex-row items-start gap-1.5">
            {value.length > 0 && (
              <Pressable
                testID="palette-clear"
                onPress={() => onChangeText("")}
                className="mt-1 size-8 items-center justify-center rounded-full bg-muted"
              >
                <Svg
                  width={15}
                  height={15}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke={stroke(false)}
                  strokeWidth={2.6}
                  strokeLinecap="round"
                >
                  <Path d="M6 6l12 12M18 6 6 18" />
                </Svg>
              </Pressable>
            )}
            <Pressable
              testID="palette-send"
              disabled={!canSend}
              onPress={onSend}
              className={`mt-0.5 size-9 items-center justify-center rounded-full ${canSend ? "bg-primary" : "bg-muted"}`}
              style={
                canSend
                  ? {
                      shadowColor: c.orange,
                      shadowOpacity: 0.55,
                      shadowRadius: 7,
                      shadowOffset: { width: 0, height: 4 },
                    }
                  : undefined
              }
            >
              <Svg
                width={18}
                height={18}
                viewBox="0 0 24 24"
                fill="none"
                stroke={stroke(canSend)}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <Path d="M5 12h14M13 6l6 6-6 6" />
              </Svg>
            </Pressable>
          </View>
        </View>
      </Glass>
    </View>
  );
}
