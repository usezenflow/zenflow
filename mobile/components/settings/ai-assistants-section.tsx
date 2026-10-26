import { getApiAccess } from "@/api/api-access";
import { CopyButton } from "@/components/settings/copy-button";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { useBottomSheet } from "@/components/ui/bottom-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { LoadError } from "@/components/load-error";
import { useLanguage } from "@/hooks/use-language";
import { useOffline } from "@/hooks/use-offline";
import { useUserStore } from "@/hooks/use-user-store";
import { format, t } from "@/lib/i18n";
import { zonedDate } from "@zenflow/core";
import type { ApiAccessResponse } from "@zenflow/shared";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, View } from "react-native";

function Divider() {
  return <View className="mx-4 h-px bg-border" />;
}

function EndpointRow({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View className="flex-row items-center gap-2 px-4 py-2">
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-[13px] text-muted-foreground">{label}</Text>
        <Text selectable numberOfLines={1} className="text-[15px]">
          {value}
        </Text>
      </View>
      <CopyButton value={value} label={t("Copy")} iconOnly testID={testID} />
    </View>
  );
}

/** Provider tabs: one connection guide per assistant, with a snippet to copy when it has one. */
function AssistantSetup({ guides }: { guides: ApiAccessResponse["setup"] }) {
  const [selected, setSelected] = useState(guides[0]?.id);
  const guide = guides.find((g) => g.id === selected) ?? guides[0];
  if (!guide) return null;
  return (
    <View className="gap-3 px-4 py-3.5">
      <Text className="text-[15px] font-semibold">{t("Connect with")}</Text>
      <View accessibilityRole="tablist" className="flex-row rounded-full bg-muted p-0.5">
        {guides.map((g) => {
          const on = g.id === guide.id;
          return (
            <Pressable
              key={g.id}
              role="tab"
              aria-selected={on}
              onPress={() => setSelected(g.id)}
              className={cn("flex-1 items-center rounded-full py-1.5", on && "bg-card shadow-sm")}
            >
              <Text className={cn("text-[13px]", on ? "font-semibold" : "text-muted-foreground")}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {guide.link ? (
        <Pressable
          onPress={() => void Linking.openURL(guide.link!.url)}
          accessibilityRole="link"
          testID={`api-access.link.${guide.id}`}
          className="h-10 self-start justify-center rounded-full border border-border px-4 active:opacity-70"
        >
          <Text className="text-[14px] font-semibold text-primary">{guide.link.label}</Text>
        </Pressable>
      ) : null}
      <View className="gap-2">
        {guide.steps.map((step, index) => (
          <View key={step} className="flex-row gap-2.5">
            <Text className="w-4 text-[13.5px] text-muted-foreground">{index + 1}.</Text>
            <Text className="min-w-0 flex-1 text-[13.5px] leading-[19px]">{step}</Text>
          </View>
        ))}
      </View>
      {guide.code ? (
        <View className="gap-2">
          <Text selectable className="rounded-xl bg-muted/60 p-3 font-mono text-[12px] leading-[17px]">
            {guide.code}
          </Text>
          <CopyButton value={guide.code} label={t("Copy")} testID={`api-access.setup.${guide.id}`} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Settings "AI assistants": the MCP and REST endpoints, the system prompt that
 * tells an assistant about the tools, and personal tokens. Tokens are created
 * and revoked here; a revoke asks first.
 */
export function AiAssistantsSection() {
  useLanguage();
  const offline = useOffline();
  const [access, setAccess] = useState<ApiAccessResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    getApiAccess().then(
      (next) => {
        setAccess(next);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!access) {
    return (
      <>
        <SettingsSectionLabel>{t("AI assistants")}</SettingsSectionLabel>
        {failed ? (
          <LoadError
            offline={offline}
            message={t("Couldn't load AI assistants.")}
            offlineMessage={t("Back online to manage AI assistants.")}
            onRetry={load}
          />
        ) : (
          <Skeleton className="h-28 rounded-2xl" />
        )}
      </>
    );
  }

  return (
    <>
      <SettingsSectionLabel>{t("AI assistants")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        <EndpointRow label={t("MCP server")} value={access.mcpUrl} testID="api-access.mcp" />
        <Divider />
        <EndpointRow label={t("REST base URL")} value={access.restBaseUrl} testID="api-access.rest" />
        <Divider />
        <AssistantSetup guides={access.setup} />
        <Divider />
        <View className="gap-2 px-4 py-3.5">
          <Text className="text-[15px] font-semibold">{t("Prompt")}</Text>
          <Text numberOfLines={4} className="text-[13px] leading-[18px] text-muted-foreground">
            {access.prompt}
          </Text>
          <CopyButton value={access.prompt} label={t("Copy")} testID="api-access.prompt" />
        </View>
      </View>
    </>
  );
}
