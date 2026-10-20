import { connectIntegration } from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";
import { isAxiosError } from "axios";
import { BookOpen, Check, Lock, School, UserRound, type LucideIcon } from "lucide-react";
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
 * One card per LMS and portal. Connecting probes a live login on the server
 * before anything is stored; this step does not sync or disconnect.
 */
export function CampusConnectStep({
  statuses,
  onConnected,
}: {
  statuses: IntegrationStatus[];
  onConnected: (status: IntegrationStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {PROVIDERS.map((provider) => (
        <ProviderCard
          key={provider}
          provider={provider}
          connected={
            statuses.find((s) => s.provider === provider)?.connected ?? false
          }
          onConnected={onConnected}
        />
      ))}
    </div>
  );
}

function ProviderCard({
  provider,
  connected,
  onConnected,
}: {
  provider: IntegrationProvider;
  connected: boolean;
  onConnected: (status: IntegrationStatus) => void;
}) {
  useLanguage();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = provider.toLowerCase();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const status = await connectIntegration({
        provider,
        username: username.trim(),
        password,
      });
      setPassword("");
      onConnected(status);
    } catch (err) {
      setError(connectError(err, provider));
    } finally {
      setBusy(false);
    }
  }

  const { Icon } = PROVIDER_VISUAL[provider];

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span
          className={cn(
            "flex size-[38px] shrink-0 items-center justify-center rounded-xl",
            connected ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary",
          )}
        >
          {connected ? <Check className="size-[18px]" /> : <Icon className="size-[18px]" />}
        </span>
        <span className="min-w-0 flex-1 text-[15px] font-semibold">
          {providerLabel(provider)}
        </span>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-[12px] font-semibold",
            connected ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {connected ? t("Connected") : t("Not connected")}
        </span>
      </div>
      {!connected && (
        <form
          onSubmit={submit}
          className="grid grid-cols-2 gap-2.5 border-t border-border p-3"
        >
          <div className="relative">
            <Label htmlFor={`${id}-username`} className="sr-only">
              {t("Student ID")}
            </Label>
            <UserRound className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${id}-username`}
              inputMode="numeric"
              autoComplete="username"
              placeholder={t("Student ID")}
              value={username}
              disabled={busy}
              onChange={(e) => setUsername(e.target.value)}
              className="h-11 rounded-xl pl-10 text-base"
            />
          </div>
          <div className="relative">
            <Label htmlFor={`${id}-password`} className="sr-only">
              {t("Password")}
            </Label>
            <Lock className="pointer-events-none absolute top-1/2 left-3.5 size-[18px] -translate-y-1/2 text-muted-foreground" />
            <Input
              id={`${id}-password`}
              type="password"
              autoComplete="current-password"
              placeholder={t("Password")}
              value={password}
              disabled={busy}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 rounded-xl pl-10 text-base"
            />
          </div>
          {error && (
            <p className="col-span-2 text-[13px] font-medium text-destructive">{error}</p>
          )}
          <Button
            type="submit"
            className="col-span-2 h-11 w-full rounded-xl text-base"
            disabled={busy || !username.trim() || !password}
          >
            <DelayedSpinner busy={busy} className="size-4" />
            {busy ? t("Connecting…") : t("Connect")}
          </Button>
        </form>
      )}
    </div>
  );
}
