import { connectIntegration } from "@/api/integrations";
import { BookOpen, GraduationCap } from "@/components/Icons";
import { Button } from "@/components/ui/button";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { t } from "@/lib/i18n";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";
import { useState } from "react";
import { View } from "react-native";
import { ConnectTile } from "./connect-tile";

const PROVIDERS: { provider: IntegrationProvider; icon: typeof BookOpen }[] = [
  { provider: "LMS", icon: BookOpen },
  { provider: "PORTAL", icon: GraduationCap },
];

const label = (p: IntegrationProvider) => (p === "LMS" ? "LMS" : t("Student portal"));

/** One tile per LMS and portal; tapping asks one question at a time (ID, then password). */
export function CampusStep({
  statuses,
  onConnected,
}: {
  statuses: IntegrationStatus[];
  onConnected: (status: IntegrationStatus) => void;
}) {
  useLanguage();
  const [active, setActive] = useState<IntegrationProvider | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [asking, setAsking] = useState<"id" | "password">("id");

  function open(p: IntegrationProvider) {
    setActive(p);
    setAsking("id");
    setUsername("");
    setPassword("");
    setError(false);
  }

  async function submit(provider: IntegrationProvider) {
    setBusy(true);
    setError(false);
    try {
      onConnected(await connectIntegration({ provider, username: username.trim(), password }));
      setActive(null);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-3">
      {PROVIDERS.map(({ provider, icon }) => {
        const connected = statuses.find((s) => s.provider === provider)?.connected ?? false;
        const isOpen = active === provider && !connected;
        return (
          <ConnectTile
            key={provider}
            icon={icon}
            title={label(provider)}
            hint={connected ? t("Connected") : undefined}
            state={connected ? "done" : "idle"}
            onPress={() => open(provider)}
          >
            {isOpen ? (
              <View className="gap-3 border-t border-border p-4">
                <Text className="text-[16px] font-semibold">
                  {asking === "id" ? t("Your student ID?") : t("And your password?")}
                </Text>
                <Input
                  key={asking}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete={asking === "id" ? "username" : "password"}
                  keyboardType={asking === "id" ? "number-pad" : "default"}
                  secureTextEntry={asking === "password"}
                  editable={!busy}
                  value={asking === "id" ? username : password}
                  onChangeText={asking === "id" ? setUsername : setPassword}
                  onSubmitEditing={() =>
                    asking === "id" ? username.trim() && setAsking("password") : void submit(provider)
                  }
                  accessibilityLabel={asking === "id" ? t("Student ID") : t("Password")}
                />
                {error ? (
                  <Text className="text-[13px] font-medium text-destructive">
                    {t("Sign-in didn't work. Check your student ID and password.")}
                  </Text>
                ) : null}
                <Button
                  className="rounded-full"
                  disabled={busy || (asking === "id" ? !username.trim() : !password)}
                  onPress={() => (asking === "id" ? setAsking("password") : void submit(provider))}
                >
                  <BusyOr busy={busy} tone="onPrimary">
                    <Text className="font-semibold text-primary-foreground">
                      {asking === "id" ? t("Next") : t("Connect")}
                    </Text>
                  </BusyOr>
                </Button>
              </View>
            ) : null}
          </ConnectTile>
        );
      })}
    </View>
  );
}
