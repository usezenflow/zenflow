import { createApiToken } from "@/api/api-access";
import { KeyRound } from "@/components/Icons";
import { CopyButton } from "@/components/settings/copy-button";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetInput,
  BottomSheetView,
  type useBottomSheet,
} from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { ApiTokenSummary } from "@zenflow/shared";
import { useState } from "react";
import { View } from "react-native";

const NAME_MAX = 60;

/**
 * Creates a named token, then shows its secret once with a copy control.
 * Closing the sheet clears the secret.
 */
export function ApiTokenSheet({
  sheet,
  onCreated,
}: {
  sheet: ReturnType<typeof useBottomSheet>;
  onCreated: (token: ApiTokenSummary) => void;
}) {
  useLanguage();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function reset() {
    setName("");
    setSecret(null);
    setCreating(false);
  }

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const created = await createApiToken(trimmed);
      onCreated(created.token);
      setSecret(created.secret);
    } catch {
      toast({
        title: t("Couldn't create token"),
        description: t("Try again in a moment."),
        variant: "warning",
        icon: KeyRound,
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <BottomSheet>
      <BottomSheetContent ref={sheet.ref} onDismiss={reset}>
        <BottomSheetView style={{ paddingBottom: 30 }}>
          <Text className="pb-3 pt-1 text-xl font-bold tracking-tight">{t("New token")}</Text>
          {secret ? (
            <View className="gap-3">
              <View className="rounded-xl border border-border bg-muted px-4 py-3">
                <Text selectable testID="api-token.secret" className="text-[15px] leading-[21px]">
                  {secret}
                </Text>
              </View>
              <Text className="text-[13px] text-muted-foreground">
                {t("Copy it now. It won't be shown again.")}
              </Text>
              <CopyButton value={secret} label={t("Copy")} testID="api-token.copy" />
              <Button className="mt-2 rounded-xl" onPress={() => sheet.close()}>
                <Text className="font-semibold text-primary-foreground">{t("Done")}</Text>
              </Button>
            </View>
          ) : (
            <View className="gap-5">
              <Input
                as={BottomSheetInput}
                value={name}
                onChangeText={setName}
                placeholder={t("Name, for example ChatGPT")}
                accessibilityLabel={t("Name, for example ChatGPT")}
                maxLength={NAME_MAX}
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={() => void create()}
                testID="api-token.name"
              />
              <Button
                className="rounded-xl"
                disabled={!name.trim() || creating}
                onPress={() => void create()}
                testID="api-token.create"
              >
                <DelayedSpinner busy={creating} size={18} tone="onPrimary" wrapperClassName="mr-2" />
                <Text className="font-semibold text-primary-foreground">{t("Create")}</Text>
              </Button>
            </View>
          )}
        </BottomSheetView>
      </BottomSheetContent>
    </BottomSheet>
  );
}
