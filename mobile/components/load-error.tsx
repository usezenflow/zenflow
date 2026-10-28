import { CloudOffIcon } from "@/components/brand/icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { NAV_THEME } from "@/lib/constants";
import { t } from "@/lib/i18n";
import { useColorScheme } from "@/lib/useColorScheme";
import { Pressable, View } from "react-native";

/**
 * Stand-in for a block that could not load: offline is an icon and a short
 * line, a failure is a line and a retry.
 */
export function LoadError({
  offline,
  message,
  offlineMessage,
  onRetry,
}: {
  offline: boolean;
  message: string;
  offlineMessage: string;
  onRetry: () => void;
}) {
  useLanguage();
  const { isDarkColorScheme } = useColorScheme();
  const muted = (isDarkColorScheme ? NAV_THEME.dark : NAV_THEME.light).mutedForeground;
  return (
    <View
      testID="load-error"
      className="flex-row items-center gap-2.5 rounded-2xl border border-border bg-card px-4 py-2"
    >
      {offline ? <CloudOffIcon size={18} color={muted} /> : null}
      <Text className="flex-1 text-[14px] text-muted-foreground">
        {offline ? offlineMessage : message}
      </Text>
      {offline ? null : (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={t("Try again")}
          className="min-h-11 justify-center px-2 active:opacity-70"
        >
          <Text className="text-[14px] font-semibold text-foreground">{t("Try again")}</Text>
        </Pressable>
      )}
    </View>
  );
}
