import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Bot, Check, Copy, Plus, Trash2 } from "lucide-react";
import type { ApiAccessResponse, ApiTokenSummary } from "@zenflow/shared";
import { createApiToken, getApiAccess, revokeApiToken } from "@/api/me";
import { Divider, IconTile, SettingsCard, SettingsLabel } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage, errorToast } from "@/lib/toast";

/** Copies `value` and shows a check for a moment. */
function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      errorToast(t("Couldn't copy"));
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={copy} aria-label={label} className="shrink-0 rounded-full">
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {copied ? t("Copied") : t("Copy")}
    </Button>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] text-muted-foreground">{label}</p>
        <p className="truncate text-[15px] font-medium">{value}</p>
      </div>
      <CopyButton value={value} label={`${t("Copy")} ${label}`} />
    </div>
  );
}

function lastUsedLabel(token: ApiTokenSummary, tz: string): string {
  if (!token.lastUsedAt) return t("Never used");
  const date = new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeZone: tz }).format(
    new Date(token.lastUsedAt),
  );
  return t("Last used {date}", { date });
}

/** One token, with an inline confirm step before it is revoked. */
function TokenRow({
  token,
  tz,
  onRevoked,
}: {
  token: ApiTokenSummary;
  tz: string;
  onRevoked: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await revokeApiToken(token.id);
      await onRevoked();
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Couldn't revoke the token")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{token.name}</p>
          <p className="text-[13px] text-muted-foreground">{lastUsedLabel(token, tz)}</p>
        </div>
        {confirming ? null : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <Trash2 className="size-3.5" aria-hidden />
            {t("Revoke")}
          </Button>
        )}
      </div>
      {confirming ? (
        <div className="mt-2 flex flex-col gap-2 rounded-xl bg-destructive/10 p-3">
          <p className="text-[13px] font-semibold">{t("Revoke {name}?", { name: token.name })}</p>
          <p className="text-[13px] text-muted-foreground">{t("Assistants using it stop working.")}</p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" size="sm" onClick={revoke} disabled={busy}>
              {t("Revoke")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Create a token: the secret is shown once in the dialog and cleared when it closes.
 */
function CreateTokenDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);

  function close(next: boolean) {
    if (!next) {
      setName("");
      setSecret(null);
    }
    onOpenChange(next);
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await createApiToken({ name: trimmed });
      setSecret(created.secret);
      setName("");
      await onCreated();
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Couldn't create the token")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {secret ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("Copy your token")}</DialogTitle>
              <DialogDescription>{t("It won't be shown again.")}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={secret}
                aria-label={t("Token")}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-[13px]"
              />
              <CopyButton value={secret} label={t("Copy token")} />
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>{t("Done")}</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={create} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("Create token")}</DialogTitle>
              <DialogDescription>{t("Name the assistant this token is for.")}</DialogDescription>
            </DialogHeader>
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="ChatGPT"
              aria-label={t("Name")}
              maxLength={60}
              disabled={busy}
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => close(false)} disabled={busy}>
                {t("Cancel")}
              </Button>
              <Button type="submit" disabled={!name.trim() || busy}>
                {t("Create")}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Settings block for AI assistants: MCP and REST endpoints, the system prompt and personal tokens. */
export function AiAssistantsSection() {
  useLanguage();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [access, setAccess] = useState<ApiAccessResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setAccess(await getApiAccess());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <SettingsLabel>{t("AI assistants")}</SettingsLabel>
      <SettingsCard>
        <div className="flex items-center gap-[13px] px-4 py-3.5">
          <IconTile icon={Bot} />
          <p className="min-w-0 flex-1 text-[15px] text-muted-foreground">
            {t("Let an assistant read and plan your calendar.")}
          </p>
        </div>

        {access ? (
          <>
            <Divider />
            <CopyRow label={t("MCP server")} value={access.mcpUrl} />
            <Divider />
            <CopyRow label={t("REST base URL")} value={access.restBaseUrl} />
            <Divider />
            <div className="px-4 py-3.5">
              <p className="text-[15px] font-semibold">{t("Connect with")}</p>
              <Tabs defaultValue={access.setup[0]?.id} className="mt-2">
                <TabsList className="w-full">
                  {access.setup.map((guide) => (
                    <TabsTrigger key={guide.id} value={guide.id}>
                      {guide.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {access.setup.map((guide) => (
                  <TabsContent key={guide.id} value={guide.id} className="mt-3">
                    <ol className="flex list-decimal flex-col gap-2 pl-5 text-[13.5px] leading-snug">
                      {guide.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                    {guide.code && (
                      <div className="mt-3 flex flex-col gap-2">
                        <pre className="max-h-40 overflow-auto rounded-xl bg-muted/60 p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">
                          {guide.code}
                        </pre>
                        <CopyButton value={guide.code} label={t("Copy")} />
                      </div>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </div>
            <Divider />
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[13px] text-muted-foreground">{t("System prompt")}</p>
                <CopyButton value={access.prompt} label={t("Copy prompt")} />
              </div>
              <pre className="mt-2 max-h-40 overflow-auto rounded-xl bg-muted/60 p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
                {access.prompt}
              </pre>
            </div>
            <Divider />
            <div className="px-4 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[15px] font-semibold">{t("Tokens")}</p>
                <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)} className="rounded-full">
                  <Plus className="size-3.5" aria-hidden />
                  {t("Create token")}
                </Button>
              </div>
              {access.tokens.length === 0 ? (
                <p className="mt-2 text-[13px] text-muted-foreground">{t("No tokens yet")}</p>
              ) : (
                <ul className="mt-1 divide-y divide-border">
                  {access.tokens.map((token) => (
                    <TokenRow key={token.id} token={token} tz={tz} onRevoked={load} />
                  ))}
                </ul>
              )}
            </div>
            <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
          </>
        ) : failed ? (
          <div className="flex items-center justify-between gap-3 px-4 py-3.5">
            <p className="text-[13px] text-muted-foreground">{t("Couldn't load AI access.")}</p>
            <Button variant="outline" size="sm" onClick={() => void load()} className="rounded-full">
              {t("Try again")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 px-4 py-3.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        )}
      </SettingsCard>
    </>
  );
}
