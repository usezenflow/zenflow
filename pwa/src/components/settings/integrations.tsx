import { useEffect, useRef, useState } from "react";
import { isAxiosError } from "axios";
import { toast } from "@/lib/notify";
import {
  AlertCircle,
  CreditCard,
  Eye,
  EyeOff,
  GraduationCap,
  KeyRound,
  MoreHorizontal,
  RefreshCw,
  Unlink,
} from "lucide-react";
import type { IntegrationProvider, IntegrationStatus } from "@zenflow/shared";
import {
  connectIntegration,
  disconnectIntegration,
  listIntegrations,
  syncIntegration,
  updateIntegration,
} from "@/api/integrations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import {
  Divider,
  SettingsCard,
  SettingsSheet,
} from "@/components/settings/settings-ui";
import { studentIdOf } from "@/components/settings/settings-utils";
import { useUserStore } from "@/hooks/use-user-store";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

type Sheet = "manage" | "sign-in" | "disconnect";
type SignInMode = "connect" | "update";
type Tone = "muted" | "ok" | "error";

const PROVIDERS: IntegrationProvider[] = ["LMS", "PORTAL"];
const SETTLE_POLL_MS = 3000;
const SETTLE_MAX_POLLS = 40;

function providerLabel(provider: IntegrationProvider): string {
  return provider === "LMS" ? "LMS" : t("Student portal");
}

/** The provider as it reads mid-sentence. */
function providerName(provider: IntegrationProvider): string {
  return provider === "LMS" ? "LMS" : t("student portal");
}

/** Compact "5 min ago" / "3 hours ago" / "2 days ago". */
function shortAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{count} min ago", { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("{count} hours ago", { count: hours });
  return t("{count} days ago", { count: Math.floor(hours / 24) });
}

/** One short subtitle per row: the last successful sync is the thing worth showing. */
function rowSubtitle(status: IntegrationStatus | undefined, syncing: boolean): { text: string; tone: Tone } {
  if (!status?.connected) return { text: t("Not connected"), tone: "muted" };
  if (syncing || status.lastSyncStatus === "PROCESSING") {
    return { text: t("Syncing…"), tone: "muted" };
  }
  // A failed or partial run does not move `lastSuccessAt`, so it stays the honest "last synced".
  if (status.failing || status.lastSyncStatus === "FAILED") {
    return {
      text: status.lastSuccessAt
        ? t("Sync failing, last synced {time}", { time: shortAgo(status.lastSuccessAt) })
        : t("Sync failing"),
      tone: "error",
    };
  }
  if (status.lastSuccessAt) {
    return { text: t("Synced {time}", { time: shortAgo(status.lastSuccessAt) }), tone: "ok" };
  }
  return { text: t("Connected"), tone: "ok" };
}

/** Why a manual sync did not go through, in words a student can act on. */
function syncErrorToast(error: unknown, provider: IntegrationProvider): { title: string; description: string } {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 429) {
      const seconds = Number(error.response?.headers?.["retry-after"]);
      return {
        title: t("Synced a moment ago"),
        description:
          Number.isFinite(seconds) && seconds > 0
            ? t("Try again in {count} min.", { count: Math.ceil(seconds / 60) })
            : t("Try again shortly."),
      };
    }
    if (status === 409) {
      return { title: t("Sync in progress"), description: t("It will finish soon.") };
    }
    if (status === 502) {
      return {
        title: t("Sync didn't finish"),
        description: t("Check your account details and try again."),
      };
    }
    if (status === 503) {
      return {
        title: t("Couldn't reach {provider}", { provider: providerLabel(provider) }),
        description: t("Try again in a bit."),
      };
    }
  }
  return { title: t("Sync failed"), description: t("Try again in a moment.") };
}

function signInErrorMessage(error: unknown, provider: IntegrationProvider, ownId: string): string {
  if (isAxiosError(error)) {
    if (error.response?.data?.code === "STUDENT_ID_MISMATCH") {
      return t("Use your own student ID ({id}) to connect.", { id: ownId });
    }
    if (error.code === "ERR_CANCELED") {
      return t("{provider} is taking too long. Try again in a bit.", { provider: providerLabel(provider) });
    }
    if (error.response?.status === 503) {
      return t("Couldn't reach {provider}. Try again in a bit.", { provider: providerLabel(provider) });
    }
  }
  return t("Sign-in didn't work. Check your student ID and password.");
}

/** Re-read `provider`'s status until its run is no longer in progress. */
async function settleStatus(
  provider: IntegrationProvider,
  update: (status: IntegrationStatus) => void,
  isActive: () => boolean,
): Promise<void> {
  for (let i = 0; i < SETTLE_MAX_POLLS && isActive(); i++) {
    try {
      const fresh = (await listIntegrations()).find((s) => s.provider === provider);
      if (fresh) {
        update(fresh);
        if (fresh.lastSyncStatus !== "PROCESSING") return;
      }
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

function ProviderIcon({
  provider,
  connected,
  failing,
}: {
  provider: IntegrationProvider;
  connected: boolean;
  failing: boolean;
}) {
  const Icon = provider === "LMS" ? GraduationCap : CreditCard;
  return (
    <span
      className={cn(
        "relative flex size-[38px] shrink-0 items-center justify-center rounded-xl",
        failing ? "bg-destructive/15" : connected ? "bg-brand-lime/25" : "bg-muted",
      )}
    >
      <Icon
        className={cn(
          "size-[18px]",
          failing ? "text-destructive" : connected ? "text-brand-lime" : "text-muted-foreground",
        )}
      />
      {failing ? (
        <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full border-2 border-card bg-destructive">
          <AlertCircle className="size-2.5 text-card" />
        </span>
      ) : connected ? (
        <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-brand-lime" />
      ) : null}
    </span>
  );
}

/** LMS and student-portal accounts: connect, update credentials, sync and disconnect. */
export function IntegrationsPanel() {
  useLanguage();
  const ownId = studentIdOf(useUserStore((s) => s.user?.email));
  const [statuses, setStatuses] = useState<IntegrationStatus[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [provider, setProvider] = useState<IntegrationProvider | null>(null);
  const [mode, setMode] = useState<SignInMode>("connect");
  const [studentId, setStudentId] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [syncing, setSyncing] = useState<IntegrationProvider[]>([]);
  // Stops the status poll once the panel unmounts.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    listIntegrations()
      .then((list) => {
        if (active) setStatuses(list);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function retryLoad() {
    setLoadFailed(false);
    listIntegrations()
      .then(setStatuses)
      .catch(() => setLoadFailed(true));
  }

  function applyStatus(status: IntegrationStatus) {
    setStatuses((prev) => {
      const list = prev ?? [];
      return list.some((s) => s.provider === status.provider)
        ? list.map((s) => (s.provider === status.provider ? status : s))
        : [...list, status];
    });
  }

  function openSignIn(next: IntegrationProvider, nextMode: SignInMode) {
    setProvider(next);
    setMode(nextMode);
    setError(null);
    // The server only accepts the student's own ID, so a new connection starts with it.
    setStudentId(nextMode === "connect" ? ownId : "");
    setPassword("");
    setShowPassword(false);
    setSheet("sign-in");
  }

  function closeSheet() {
    setSheet(null);
    setStudentId("");
    setPassword("");
    setError(null);
    setShowPassword(false);
  }

  async function submit() {
    if (!provider) return;
    const username = studentId.trim();
    setSubmitting(true);
    setError(null);
    try {
      const status =
        mode === "connect"
          ? await connectIntegration({ provider, username, password })
          : await updateIntegration(provider, {
              ...(username ? { username } : {}),
              ...(password ? { password } : {}),
            });
      applyStatus(status);
      toast.success(mode === "connect" ? t("Connected") : t("Credentials updated"));
      closeSheet();
    } catch (err) {
      setError(signInErrorMessage(err, provider, ownId));
    } finally {
      setSubmitting(false);
    }
  }

  async function sync(target: IntegrationProvider) {
    setSyncing((current) => [...current, target]);
    try {
      applyStatus(await syncIntegration(target));
      toast.success(t("{provider} synced", { provider: providerLabel(target) }));
    } catch (err) {
      const copy = syncErrorToast(err, target);
      errorToast(copy.title, { description: copy.description });
      // The server may have moved the status even though the request failed: re-read until settled.
      void settleStatus(target, applyStatus, () => mountedRef.current);
    } finally {
      setSyncing((current) => current.filter((p) => p !== target));
    }
  }

  async function disconnect() {
    if (!provider) return;
    setSubmitting(true);
    try {
      applyStatus(await disconnectIntegration(provider));
      toast.success(t("Disconnected"));
      closeSheet();
    } catch {
      errorToast(t("Couldn't disconnect"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!statuses) {
    if (loadFailed) {
      return (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("Couldn't load your integrations.")}
          <Button variant="link" className="h-auto p-0" onClick={retryLoad}>
            {t("Retry")}
          </Button>
        </div>
      );
    }
    return (
      <div className="flex justify-center py-10 text-muted-foreground">
        <DelayedSpinner busy className="size-5" />
      </div>
    );
  }

  const name = provider ? providerName(provider) : "";
  const label = provider ? providerLabel(provider) : "";
  const canSubmit =
    !submitting &&
    (mode === "connect" ? !!studentId.trim() && !!password : !!studentId.trim() || !!password);

  return (
    <>
      <SettingsCard>
        {PROVIDERS.map((item, index) => {
          const status = statuses.find((s) => s.provider === item);
          const connected = !!status?.connected;
          const isSyncing = syncing.includes(item);
          const subtitle = rowSubtitle(status, isSyncing);
          return (
            <div key={item}>
              {index > 0 ? <Divider /> : null}
              <div className="px-4 py-3.5">
                <div className="flex items-center gap-3.5">
                  <ProviderIcon provider={item} connected={connected} failing={subtitle.tone === "error"} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] font-semibold">{providerLabel(item)}</p>
                    <p
                      className={cn(
                        "mt-0.5 truncate text-[13px]",
                        subtitle.tone === "ok" && "text-session-done-ink",
                        subtitle.tone === "error" && "text-destructive",
                        subtitle.tone === "muted" && "text-muted-foreground",
                      )}
                    >
                      {subtitle.text}
                    </p>
                  </div>
                  {connected ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Manage {provider}", { provider: providerLabel(item) })}
                      onClick={() => {
                        setProvider(item);
                        setSheet("manage");
                      }}
                    >
                      <MoreHorizontal className="text-muted-foreground" />
                    </Button>
                  ) : (
                    <Button size="sm" disabled={submitting} onClick={() => openSignIn(item, "connect")}>
                      {t("Connect")}
                    </Button>
                  )}
                </div>
                {connected ? (
                  <div className="mt-2.5 pl-[51px]">
                    <Button
                      size="sm"
                      disabled={isSyncing}
                      aria-label={t("Sync {provider} now", { provider: providerLabel(item) })}
                      onClick={() => void sync(item)}
                    >
                      <RefreshCw className={cn(isSyncing && "animate-spin")} />
                      {isSyncing ? t("Syncing…") : t("Sync now")}
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </SettingsCard>

      <SettingsSheet
        open={sheet === "manage"}
        onOpenChange={(open) => !open && closeSheet()}
        title={label}
      >
        <div className="flex flex-col gap-1">
          <Button variant="ghost" className="justify-start gap-3" onClick={() => provider && openSignIn(provider, "update")}>
            <KeyRound />
            {t("Update login")}
          </Button>
          <Button
            variant="ghost"
            className="justify-start gap-3 text-destructive hover:text-destructive"
            onClick={() => setSheet("disconnect")}
          >
            <Unlink />
            {t("Disconnect")}
          </Button>
        </div>
      </SettingsSheet>

      <SettingsSheet
        open={sheet === "sign-in"}
        onOpenChange={(open) => !open && closeSheet()}
        title={
          mode === "connect"
            ? t("Sign in to your {provider}", { provider: name })
            : t("Update your {provider} login", { provider: name })
        }
        description={
          mode === "connect"
            ? t("Use the login you have for {provider}. Zenflow only uses it to check for new assignments and classes.", {
                provider: name,
              })
            : t("Leave a field blank to keep what's saved.")
        }
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          {error ? (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-3.5 text-[14px] text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="integration-student-id">{t("Student ID")}</Label>
            <Input
              id="integration-student-id"
              value={studentId}
              onChange={(event) => setStudentId(event.target.value)}
              placeholder={mode === "connect" ? "2112345" : t("Leave blank to keep")}
              autoComplete="off"
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="integration-password">{t("Password")}</Label>
            <div className="relative">
              <Input
                id="integration-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder={mode === "connect" ? "••••••••" : t("Leave blank to keep")}
                autoComplete="off"
                disabled={submitting}
                className="pr-9"
                aria-invalid={!!error}
              />
              <button
                type="button"
                aria-label={showPassword ? t("Hide password") : t("Show password")}
                onClick={() => setShowPassword((current) => !current)}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="w-full" disabled={!canSubmit}>
            {submitting
              ? mode === "connect"
                ? t("Connecting…")
                : t("Saving…")
              : error
                ? t("Try again")
                : mode === "connect"
                  ? t("Connect")
                  : t("Update login")}
          </Button>
        </form>
      </SettingsSheet>

      <SettingsSheet
        open={sheet === "disconnect"}
        onOpenChange={(open) => !open && closeSheet()}
        title={t("Disconnect {provider}?", { provider: name })}
        description={t("Zenflow will stop checking {provider} for new assignments. You can reconnect any time.", {
          provider: name,
        })}
      >
        <div className="flex gap-2.5">
          <Button variant="outline" className="flex-1" disabled={submitting} onClick={closeSheet}>
            {t("Keep it")}
          </Button>
          <Button variant="destructive" className="flex-1" disabled={submitting} onClick={() => void disconnect()}>
            {t("Disconnect")}
          </Button>
        </div>
      </SettingsSheet>
    </>
  );
}
