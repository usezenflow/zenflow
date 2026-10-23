import { getApiAccess, revokeApiToken } from "@/api/api-access";
import { KeyRound, Plus } from "@/components/Icons";
import { ApiTokenSheet } from "@/components/settings/api-token-sheet";
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
import type { ApiAccessResponse, ApiTokenSummary } from "@zenflow/shared";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";

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
  const { confirm, toast } = useToast();
  const offline = useOffline();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const sheet = useBottomSheet();
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

  function added(token: ApiTokenSummary) {
    setAccess((cur) => (cur ? { ...cur, tokens: [token, ...cur.tokens] } : cur));
  }

  async function revoke(token: ApiTokenSummary) {
    try {
      await revokeApiToken(token.id);
      setAccess((cur) =>
        cur ? { ...cur, tokens: cur.tokens.filter((x) => x.id !== token.id) } : cur,
      );
      toast({ title: t("Token revoked"), icon: KeyRound });
    } catch {
      toast({
        title: t("Couldn't revoke token"),
        description: t("Try again in a moment."),
        variant: "warning",
        icon: KeyRound,
      });
    }
  }

  function askRevoke(token: ApiTokenSummary) {
    confirm(t("Revoke {name}?", { name: token.name }), {
      description: t("Assistants using it lose access."),
      confirmLabel: t("Revoke"),
      cancelLabel: t("Cancel"),
      onConfirm: () => void revoke(token),
    });
  }

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

      <SettingsSectionLabel>{t("Tokens")}</SettingsSectionLabel>
      <View className="overflow-hidden rounded-2xl border border-border bg-card">
        {access.tokens.length === 0 ? (
          <Text className="px-4 py-3.5 text-[14px] text-muted-foreground">{t("No tokens yet.")}</Text>
        ) : (
          access.tokens.map((token, index) => (
            <View key={token.id}>
              {index > 0 ? <Divider /> : null}
              <View testID={`api-access.token.${token.id}`} className="flex-row items-center gap-3 px-4 py-2.5">
                <View className="min-w-0 flex-1 gap-0.5">
                  <Text numberOfLines={1} className="text-[15px] font-semibold">
                    {token.name}
                  </Text>
                  <Text className="text-[12px] text-muted-foreground">
                    {t("Created {date}", { date: format(zonedDate(token.createdAt, tz), "MMM d yyyy") })}
                  </Text>
                  <Text className="text-[12px] text-muted-foreground">
                    {token.lastUsedAt
                      ? t("Last used {date}", {
                          date: format(zonedDate(token.lastUsedAt, tz), "MMM d yyyy"),
                        })
                      : t("Never used")}
                  </Text>
                </View>
                <Pressable
                  onPress={() => askRevoke(token)}
                  disabled={offline}
                  accessibilityRole="button"
                  accessibilityLabel={t("Revoke {name}?", { name: token.name })}
                  className="h-11 justify-center px-2 active:opacity-70"
                >
                  <Text className="text-[14px] font-semibold text-foreground">{t("Revoke")}</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}
        <Divider />
        <Pressable
          onPress={() => sheet.open()}
          disabled={offline}
          accessibilityRole="button"
          testID="api-access.create"
          className="h-11 flex-row items-center gap-2 px-4 active:opacity-70"
        >
          <Plus size={18} className="text-primary" />
          <Text className="text-[15px] font-semibold text-primary">{t("Create token")}</Text>
        </Pressable>
      </View>

      <ApiTokenSheet sheet={sheet} onCreated={added} />
    </>
  );
}
