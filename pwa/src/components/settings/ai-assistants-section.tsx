import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Bot, Check, Copy, Plus, Trash2 } from "lucide-react";
import type { ApiAccessResponse, ApiTokenSummary } from "@zenflow/shared";
import { createApiToken, getApiAccess, revokeApiToken } from "@/api/me";
import { IconTile, SettingsCard, SettingsLabel } from "@/components/settings/settings-ui";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** How often the test step asks the server whether an assistant has called yet. */
const TEST_POLL_MS = 5000;

type StepId = "token" | "server" | "prompt" | "test";

interface Step {
  id: StepId;
  title: string;
  body: string;
  done: boolean;
  /** Ticked by hand. The test step is ticked by a real call instead. */
  manual: boolean;
  content: ReactNode;
}

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
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3">
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

/**
 * Settings block for AI assistants: a four-step timeline from token to first
 * call. The test step ticks itself once an assistant calls the server.
 */
export function AiAssistantsSection() {
  useLanguage();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [access, setAccess] = useState<ApiAccessResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Partial<Record<StepId, boolean>>>({});
  const [openId, setOpenId] = useState<StepId | null>(null);
  const [connected, setConnected] = useState(false);
  /** Last-used stamps as first seen here, so only a newer call counts as the test. */
  const seenUse = useRef<Map<string, string | null> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await getApiAccess();
      seenUse.current ??= new Map(next.tokens.map((token) => [token.id, token.lastUsedAt]));
      setConnected(
        next.tokens.some(
          (token) =>
            token.lastUsedAt !== null &&
            token.lastUsedAt !== (seenUse.current?.get(token.id) ?? null),
        ),
      );
      setAccess(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tokens = access?.tokens ?? [];
  const guides = access?.setup ?? [];
  const guide = guides.find((g) => g.id === providerId) ?? guides[0];
  const question = t("What's on my calendar today?");

  const steps: Step[] = access
    ? [
        {
          id: "token",
          title: t("Create a token"),
          body: t("One token per assistant. It is shown once."),
          done: tokens.length > 0,
          manual: false,
          content: (
            <>
              {tokens.length > 0 && (
                <ul className="divide-y divide-border rounded-xl border border-border bg-card px-3.5">
                  {tokens.map((token) => (
                    <TokenRow key={token.id} token={token} tz={tz} onRevoked={load} />
                  ))}
                </ul>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCreateOpen(true)}
                className="self-start rounded-full"
              >
                <Plus className="size-3.5" aria-hidden />
                {t("Create token")}
              </Button>
            </>
          ),
        },
        {
          id: "server",
          title: t("Add the server"),
          body: t("Add this MCP server in your assistant's settings."),
          done: ticked.server === true,
          manual: true,
          content: (
            <>
              <CopyRow label={t("MCP server")} value={access.mcpUrl} />
              {guides.length > 0 && (
                <Tabs value={guide?.id} onValueChange={setProviderId}>
                  <TabsList className="w-full">
                    {guides.map((g) => (
                      <TabsTrigger key={g.id} value={g.id}>
                        {g.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              )}
              {guide && (
                <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-[13.5px] leading-snug text-muted-foreground">
                  {guide.steps.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ol>
              )}
              {guide?.code && (
                <div className="flex flex-col gap-2">
                  <pre className="max-h-32 overflow-auto rounded-xl bg-muted/60 p-3 text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">
                    {guide.code}
                  </pre>
                  <CopyButton value={guide.code} label={t("Copy")} />
                </div>
              )}
            </>
          ),
        },
        {
          id: "prompt",
          title: t("Paste the system prompt"),
          body: t("Paste it into the assistant's instructions."),
          done: ticked.prompt === true,
          manual: true,
          content: (
            <div className="flex flex-col gap-2">
              <pre className="max-h-32 overflow-auto rounded-xl bg-muted/60 p-3 text-[13px] leading-relaxed whitespace-pre-wrap">
                {access.prompt}
              </pre>
              <CopyButton value={access.prompt} label={t("Copy prompt")} />
            </div>
          ),
        },
        {
          id: "test",
          title: t("Ask a question"),
          body: t("Send this in a new chat. Zenflow confirms the first call here."),
          done: connected,
          manual: false,
          content: (
            <>
              <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3.5 py-3">
                <p className="min-w-0 text-[14px] font-medium">{question}</p>
                <CopyButton value={question} label={t("Copy question")} />
              </div>
              <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
                {connected ? (
                  <Check className="size-4 text-primary" aria-hidden />
                ) : (
                  <span aria-hidden className="size-2 animate-pulse rounded-full bg-primary" />
                )}
                {connected ? t("Connected") : t("Waiting for the first call")}
              </p>
              {!connected && (
                <Button variant="ghost" size="sm" onClick={() => void load()} className="self-start rounded-full">
                  {t("Check now")}
                </Button>
              )}
            </>
          ),
        },
      ]
    : [];

  const activeId = steps.find((step) => !step.done)?.id;
  const doneCount = steps.filter((step) => step.done).length;

  // Only the test step polls, and only while it is the one to do.
  useEffect(() => {
    if (activeId !== "test") return;
    const timer = window.setInterval(() => void load(), TEST_POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, load]);

  return (
    <>
      <SettingsLabel>{t("AI assistants")}</SettingsLabel>
      <SettingsCard>
        <div className="flex items-center gap-[13px] px-4 py-3.5">
          <IconTile icon={Bot} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">{t("Let an assistant read and plan your calendar.")}</p>
            {access && (
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                {t("{done} of {total} steps done", { done: doneCount, total: steps.length })}
              </p>
            )}
          </div>
        </div>

        {access ? (
          <div className="px-4 pb-4">
            <div className="mb-5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${(doneCount / steps.length) * 100}%` }}
              />
            </div>
            <ol>
              {steps.map((step, index) => {
                const last = index === steps.length - 1;
                const open = step.id === "token" || step.id === (openId ?? activeId);
                return (
                  <li key={step.id} className={cn("relative flex gap-3.5", !last && "pb-5")}>
                    {!last && (
                      <span
                        aria-hidden
                        className={cn(
                          "absolute top-9 bottom-0 left-[15px] w-px",
                          step.done ? "bg-primary" : "bg-border",
                        )}
                      />
                    )}
                    <span
                      className={cn(
                        "relative flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
                        step.done
                          ? "bg-primary text-primary-foreground"
                          : step.id === activeId
                            ? "bg-primary/15 text-primary ring-2 ring-primary/30"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {step.done ? <Check className="size-4" aria-hidden /> : index + 1}
                    </span>
                    <div className="min-w-0 flex-1 pt-1.5">
                      <button
                        type="button"
                        onClick={() => setOpenId(step.id)}
                        aria-expanded={open}
                        className="flex w-full items-center justify-between gap-3 text-left"
                      >
                        <span className="text-[15px] font-semibold">{step.title}</span>
                        {step.done && <span className="text-[12px] font-medium text-primary">{t("Done")}</span>}
                      </button>
                      {open && (
                        <div className="mt-2.5 flex flex-col gap-3">
                          <p className="text-[13.5px] leading-snug text-muted-foreground">{step.body}</p>
                          {step.content}
                          {step.manual && (
                            <Button
                              variant={step.done ? "ghost" : "outline"}
                              size="sm"
                              onClick={() => setTicked((prev) => ({ ...prev, [step.id]: !step.done }))}
                              className="self-start rounded-full"
                            >
                              {step.done ? t("Undo") : t("Mark done")}
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
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
      <CreateTokenDialog open={createOpen} onOpenChange={setCreateOpen} onCreated={load} />
    </>
  );
}
