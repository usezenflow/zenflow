import { AlertTriangle, type LucideIcon } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Pressable, View } from "react-native";

/**
 * An inline message with an icon. `error` is for something that failed,
 * `info` (blue) for a hint. Optional action sits on the right.
 */
export function Notice({
  tone = "error",
  icon: Icon = AlertTriangle,
  title,
  detail,
  actionLabel,
  onAction,
  testID,
  className,
}: {
  tone?: "error" | "info";
  icon?: LucideIcon;
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
  className?: string;
}) {
  const error = tone === "error";
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      className={cn(
        "flex-row items-center gap-3 rounded-2xl border px-3.5 py-3",
        error ? "border-destructive/30 bg-destructive/10" : "border-session-lecture/30 bg-session-lecture/10",
        className,
      )}
    >
      <View
        className={cn(
          "h-8 w-8 items-center justify-center rounded-full",
          error ? "bg-destructive/15" : "bg-session-lecture/15",
        )}
      >
        <Icon size={16} className={error ? "text-destructive" : "text-session-lecture-ink"} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-semibold">{title}</Text>
        {detail ? <Text className="text-[13px] text-muted-foreground">{detail}</Text> : null}
      </View>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          hitSlop={6}
          className="h-8 items-center justify-center rounded-full bg-background px-3 active:opacity-80"
        >
          <Text className={cn("text-[13px] font-semibold", error ? "text-destructive" : "text-primary")}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
