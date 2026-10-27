import { getApiAccess } from "@/api/api-access";
import { AssistantConnect } from "@/components/settings/assistant-connect";
import { CopyButton } from "@/components/settings/copy-button";
import { SettingsSectionLabel } from "@/components/settings/settings-header";
import { useBottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
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
import { useCallback, useEffect, useState, type ReactNode } from "react";
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

function StepRow({ n, last, children }: { n: number; last: boolean; children: ReactNode }) {
  return (
    <View className="flex-row gap-3">
      <View className="items-center">
        <View className="h-6 w-6 items-center justify-center rounded-full bg-primary">
          <Text className="text-[12px] font-bold text-primary-foreground">{n}</Text>
        </View>
        {last ? null : <View className="mt-1 w-px flex-1 bg-border" />}
      </View>
      <View className={cn("min-w-0 flex-1 gap-2", !last && "pb-4")}>{children}</View>
    </View>
  );
}

/** Provider tabs, then numbered steps: copy the address, open the assistant, follow the guide. */
function AssistantSetup({ access }: { access: ApiAccessResponse }) {
  const guides = access.setup;
  const [selected, setSelected] = useState(guides[0]?.id);
  const guide = guides.find((g) => g.id === selected) ?? guides[0];
  if (!guide) return null;
  const steps: ReactNode[] = [];
  if (!guide.code) {
    steps.push(
      <>
        <Text className="text-[14px] font-semibold">{t("Copy the address")}</Text>
        <View className="flex-row items-center gap-2 rounded-xl bg-muted/60 py-1 pl-3 pr-1">
          <Text selectable numberOfLines={1} className="min-w-0 flex-1 text-[13px]">
            {access.mcpUrl}
          </Text>
          <CopyButton value={access.mcpUrl} label={t("Copy")} iconOnly testID="api-access.mcp" />
        </View>
      </>,
    );
  }
  if (guide.link) {
    const { url, label } = guide.link;
    steps.push(
      <Button onPress={() => void Linking.openURL(url)} testID={`api-access.link.${guide.id}`} className="self-start">
        <Text>{label}</Text>
      </Button>,
    );
  }
  guide.steps.forEach((step) => steps.push(<Text className="text-[14px] leading-[20px]">{step}</Text>));
  if (guide.code) {
    steps.push(
      <>
        <Text selectable className="rounded-xl bg-muted/60 p-3 font-mono text-[12px] leading-[17px]">
          {guide.code}
        </Text>
        <CopyButton value={guide.code} label={t("Copy")} testID={`api-access.setup.${guide.id}`} />
      </>,
    );
  }
  return (
    <View className="gap-4 px-4 py-4">
      <View className="gap-1">
        <Text className="text-[17px] font-semibold">{t("Connect your AI assistant")}</Text>
        <Text className="text-[13px] text-muted-foreground">{t("Pick one and follow the steps.")}</Text>
      </View>
      <View accessibilityRole="tablist" className="flex-row rounded-full bg-muted p-0.5">
        {guides.map((g) => {
          const on = g.id === guide.id;
          return (
            <Pressable
              key={g.id}
              role="tab"
              aria-selected={on}
              onPress={() => setSelected(g.id)}
              className={cn("flex-1 items-center rounded-full py-2", on && "bg-card")}
            >
              <Text className={cn("text-[13px]", on ? "font-semibold" : "text-muted-foreground")}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View>
        {steps.map((node, i) => (
          <StepRow key={`${guide.id}-${i}`} n={i + 1} last={i === steps.length - 1}>
            {node}
          </StepRow>
        ))}
      </View>
      {guide.code ? <EndpointRow label={t("REST base URL")} value={access.restBaseUrl} testID="api-access.rest" /> : null}
    </View>
  );
}

/** Settings "AI assistants": connect an assistant to Zenflow over MCP. The system prompt ships with the server. */
export function AiAssistantsSection({ connectCode }: { connectCode?: string }) {
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
        <AssistantConnect initialCode={connectCode} />
        <Divider />
        <AssistantSetup access={access} />
      </View>
    </>
  );
}
