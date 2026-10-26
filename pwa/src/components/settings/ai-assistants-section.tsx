import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Bot, Check, Copy, ExternalLink } from "lucide-react";
import type { ApiAccessResponse, ConnectedApp } from "@zenflow/shared";
import { getApiAccess } from "@/api/me";
import { disconnectApp, listConnectedApps } from "@/api/oauth";
import { IconTile, SettingsCard, SettingsLabel } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { t, useLanguage } from "@/lib/i18n";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** How often the test step asks the server whether an assistant has called yet. */
const TEST_POLL_MS = 5000;

type StepId = "server" | "prompt" | "test";

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

/** One connected assistant, with an inline confirm step before it is disconnected. */
function AppRow({ app, onChanged }: { app: ConnectedApp; onChanged: (apps: ConnectedApp[]) => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    try {
      onChanged((await disconnectApp(app.clientId)).apps);
    } catch (error) {
      errorToast(apiErrorMessage(error, t("Couldn't disconnect the assistant")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{app.name}</p>
        {confirming ? (
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              {t("Cancel")}
            </Button>
            <Button variant="destructive" size="sm" onClick={disconnect} disabled={busy}>
              {t("Disconnect")}
            </Button>
          </div>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirming(true)}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            {t("Disconnect")}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Settings block for AI assistants: a three-step timeline from adding the
 * server to the first call, and the assistants already connected. The test
 * step ticks itself once an assistant connects.
 */
export function AiAssistantsSection() {
  useLanguage();
  const [access, setAccess] = useState<ApiAccessResponse | null>(null);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [failed, setFailed] = useState(false);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Partial<Record<StepId, boolean>>>({});
  const [openId, setOpenId] = useState<StepId | null>(null);
  const [connected, setConnected] = useState(false);
  /** Apps as first seen here, so only a newer one counts as the test. */
  const seenApps = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const [next, linked] = await Promise.all([getApiAccess(), listConnectedApps()]);
      seenApps.current ??= new Set(linked.apps.map((app) => app.clientId));
      const newApp = linked.apps.some((app) => !seenApps.current?.has(app.clientId));
      setConnected(newApp);
      setApps(linked.apps);
      setAccess(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const guides = access?.setup ?? [];
  const guide = guides.find((g) => g.id === providerId) ?? guides[0];
  const question = t("What's on my calendar today?");

  const steps: Step[] = access
    ? [
        {
          id: "server",
          title: t("Add Zenflow"),
          body: t("Add this MCP server in your assistant. You sign in and allow access."),
          done: ticked.server === true || apps.length > 0,
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
              {guide?.link && (
                <Button asChild variant="outline" size="sm" className="self-start rounded-full">
                  <a href={guide.link.url} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-3.5" aria-hidden />
                    {guide.link.label}
                  </a>
                </Button>
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
                const open = step.id === (openId ?? activeId);
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

            {apps.length > 0 && (
              <div className="mt-5">
                <p className="mb-1 text-[13px] font-semibold text-muted-foreground">{t("Connected assistants")}</p>
                <ul className="divide-y divide-border rounded-xl border border-border bg-card px-3.5">
                  {apps.map((app) => (
                    <AppRow key={app.clientId} app={app} onChanged={setApps} />
                  ))}
                </ul>
              </div>
            )}
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
    </>
  );
}
