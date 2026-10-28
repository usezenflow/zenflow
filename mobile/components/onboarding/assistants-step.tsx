import { getApiAccess } from "@/api/api-access";
import { listConnectedApps } from "@/api/oauth";
import { Copy, Sparkles } from "@/components/Icons";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { ApiAccessResponse } from "@zenflow/shared";
import * as Clipboard from "expo-clipboard";
import { useEffect, useRef, useState } from "react";
import { Linking, Pressable, View } from "react-native";
import { ConnectTile } from "./connect-tile";

const POLL_MS = 5000;

/** One tile per assistant: tap copies the link and opens its connector page. */
export function AssistantsStep() {
  useLanguage();
  const [access, setAccess] = useState<ApiAccessResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const seenApps = useRef<Set<string> | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const [next, linked] = await Promise.all([getApiAccess(), listConnectedApps()]);
        if (!active) return;
        seenApps.current ??= new Set(linked.apps.map((a) => a.clientId));
        const newApp = linked.apps.some((a) => !seenApps.current?.has(a.clientId));
        setConnected(newApp);
        setAccess(next);
      } catch {
        // Tiles stay hidden until the guides load.
      }
    }
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!access) return <Skeleton className="h-44 w-full rounded-2xl" />;

  async function pick(id: string, link?: string) {
    setOpenId(id);
    await Clipboard.setStringAsync(access?.mcpUrl ?? "");
    if (link) void Linking.openURL(link);
  }

  return (
    <View className="gap-3">
      {access.setup
        .filter((g) => g.id !== "other")
        .map((g) => {
          const open = openId === g.id;
          return (
            <ConnectTile
              key={g.id}
              icon={Sparkles}
              title={g.label}
              hint={connected && open ? t("Connected") : open ? t("Link copied") : undefined}
              state={connected && open ? "done" : "idle"}
              onPress={() => void pick(g.id, g.link?.url)}
            >
              {open && !connected ? (
                <View className="flex-row items-center gap-2 border-t border-foreground/10 px-4 py-3">
                  <View className="size-2 rounded-full bg-primary" />
                  <Text className="flex-1 text-[12px] text-muted-foreground">{t("Waiting")}</Text>
                  <Pressable
                    onPress={() => void Clipboard.setStringAsync(access.mcpUrl)}
                    className="flex-row items-center gap-1 active:opacity-70"
                  >
                    <Copy size={14} className="text-primary" />
                    <Text className="text-[12px] font-semibold text-primary">{t("Copy link")}</Text>
                  </Pressable>
                </View>
              ) : null}
            </ConnectTile>
          );
        })}
    </View>
  );
}
