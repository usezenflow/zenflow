import { connectIntegration } from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { SettingsSheet } from "@/components/settings/settings-ui";
import { ConnectTile } from "./connect-tile";
import { t, useLanguage } from "@/lib/i18n";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { BookOpen, School, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";

const PROVIDERS: IntegrationProvider[] = ["LMS", "PORTAL"];

const PROVIDER_VISUAL: Record<IntegrationProvider, { Icon: LucideIcon }> = {
  LMS: { Icon: BookOpen },
  PORTAL: { Icon: School },
};

function providerLabel(provider: IntegrationProvider): string {
  return provider === "LMS" ? "LMS" : t("Student portal");
}

/** Sign-in errors in the words mobile uses, keyed off the HTTP status. */
function connectError(error: unknown, provider: IntegrationProvider): string {
  const status = isAxiosError(error) ? error.response?.status : undefined;
  if (status === 400) {
    return t("Sign-in didn't work. Check your student ID and password.");
  }
  if (status === 504) {
    return t("{provider} is taking too long. Try again in a bit.", {
      provider: providerLabel(provider),
    });
  }
  return t("Couldn't reach {provider}. Try again in a bit.", {
    provider: providerLabel(provider),
  });
}

/**
 * One tile per LMS and portal. Tapping asks one question at a time (ID, then
 * password) in a sheet; the server probes a live login before storing anything.
 */
export function CampusConnectStep({
  statuses,
  onConnected,
}: {
  statuses: IntegrationStatus[];
  onConnected: (status: IntegrationStatus) => void;
}) {
  useLanguage();
  const [active, setActive] = useState<IntegrationProvider | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map((provider) => {
        const connected =
          statuses.find((s) => s.provider === provider)?.connected ?? false;
        return (
          <ConnectTile
            key={provider}
            icon={PROVIDER_VISUAL[provider].Icon}
            title={providerLabel(provider)}
            hint={connected ? t("Connected") : undefined}
            state={connected ? "done" : "idle"}
            onClick={() => setActive(provider)}
          />
        );
      })}
      {active && (
        <LoginSheet
          provider={active}
          onClose={() => setActive(null)}
          onConnected={(status) => {
            onConnected(status);
            setActive(null);
          }}
        />
      )}
    </div>
  );
}

function LoginSheet({
  provider,
  onClose,
  onConnected,
}: {
  provider: IntegrationProvider;
  onClose: () => void;
  onConnected: (status: IntegrationStatus) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState<"id" | "password">("id");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (asking === "id") {
      if (username.trim()) setAsking("password");
      return;
    }
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      onConnected(
        await connectIntegration({
          provider,
          username: username.trim(),
          password,
        }),
      );
    } catch (err) {
      setError(connectError(err, provider));
      setBusy(false);
    }
  }

  const isId = asking === "id";
  return (
    <SettingsSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={providerLabel(provider)}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-[18px] font-semibold">
          {isId ? t("Your student ID?") : t("And your password?")}
        </p>
        <Input
          key={asking}
          autoFocus
          inputMode={isId ? "numeric" : undefined}
          type={isId ? "text" : "password"}
          autoComplete={isId ? "username" : "current-password"}
          aria-label={isId ? t("Student ID") : t("Password")}
          value={isId ? username : password}
          disabled={busy}
          onChange={(e) =>
            isId ? setUsername(e.target.value) : setPassword(e.target.value)
          }
          className="h-12 rounded-full px-5 text-base"
        />
        {error && (
          <p className="text-[13px] font-medium text-destructive">{error}</p>
        )}
        <Button
          type="submit"
          className="h-12 w-full rounded-full text-base"
          disabled={busy || (isId ? !username.trim() : !password)}
        >
          <DelayedSpinner busy={busy} className="size-4" />
          {busy ? t("Connecting…") : isId ? t("Next") : t("Connect")}
        </Button>
      </form>
    </SettingsSheet>
  );
}
