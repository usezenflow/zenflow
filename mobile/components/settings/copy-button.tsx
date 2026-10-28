import { Check, Copy } from "@/components/Icons";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Pressable } from "react-native";

const FEEDBACK_MS = 1600;

/**
 * Copies `value` to the clipboard and swaps its label for a short result.
 * `iconOnly` keeps the 44pt target with the label as its accessible name.
 */
export function CopyButton({
  value,
  label,
  iconOnly = false,
  testID,
}: {
  value: string;
  label: string;
  iconOnly?: boolean;
  testID?: string;
}) {
  useLanguage();
  const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    let next: "copied" | "failed" = "copied";
    try {
      await Clipboard.setStringAsync(value);
    } catch {
      next = "failed";
    }
    setResult(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setResult("idle"), FEEDBACK_MS);
  }

  const Icon = result === "copied" ? Check : Copy;
  const text =
    result === "copied"
      ? t("Copied")
      : result === "failed"
        ? t("Couldn't copy")
        : label;

  return (
    <Pressable
      onPress={copy}
      accessibilityRole="button"
      accessibilityLabel={iconOnly ? label : text}
      testID={testID}
      className={
        iconOnly
          ? "h-11 w-11 items-center justify-center rounded-xl bg-muted active:opacity-70"
          : "h-11 flex-row items-center gap-2 self-start rounded-xl bg-muted px-3.5 active:opacity-70"
      }
    >
      <Icon size={16} className="text-foreground" />
      {iconOnly ? null : <Text className="text-[14px] font-semibold">{text}</Text>}
    </Pressable>
  );
}
