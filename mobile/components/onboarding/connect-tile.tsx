import { Check } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { useColorScheme } from "@/lib/useColorScheme";
import { cn } from "@/lib/utils";
import type { ComponentType, ReactNode } from "react";
import { Pressable, View } from "react-native";

export type TileState = "idle" | "busy" | "done" | "off";

/** One tap target: the whole tile is the button. Icon, short title, one word. */
export function ConnectTile({
  icon: Icon,
  title,
  hint,
  state = "idle",
  onPress,
  testID,
  children,
}: {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  hint?: string;
  state?: TileState;
  onPress?: () => void;
  testID?: string;
  children?: ReactNode;
}) {
  const { isDarkColorScheme: dark } = useColorScheme();
  const done = state === "done";
  return (
    <View
      className={cn(
        "overflow-hidden rounded-2xl border",
        state === "off" && "opacity-60",
      )}
      style={{
        backgroundColor: dark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.5)",
        borderColor: done
          ? "rgba(255,142,62,0.6)"
          : dark
            ? "rgba(255,200,150,0.22)"
            : "rgba(255,255,255,0.7)",
      }}
    >
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={state === "busy" || state === "off"}
        className="flex-row items-center gap-3.5 px-4 py-4 active:opacity-70"
      >
        <View
          className={cn(
            "size-11 items-center justify-center rounded-2xl",
            done ? "bg-primary" : "bg-primary/15",
          )}
        >
          {done ? (
            <Check size={20} className="text-primary-foreground" />
          ) : (
            <Icon size={20} className="text-primary" />
          )}
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[16px] font-semibold">{title}</Text>
          {hint ? <Text className="mt-0.5 text-[13px] text-muted-foreground">{hint}</Text> : null}
        </View>
        <DelayedSpinner busy={state === "busy"} />
      </Pressable>
      {children}
    </View>
  );
}
