import { useState } from "react";
import { Bot, Copy, ExternalLink } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { ConnectTile } from "./connect-tile";
import { useAssistantConnected } from "./use-assistant-connected";

/**
 * One tile per assistant. Tapping copies the server link and opens the
 * assistant's connector page; the tile turns green when its first call lands.
 */
export function AssistantsStep() {
  useLanguage();
  const { access, connected } = useAssistantConnected(true);
  const [openId, setOpenId] = useState<string | null>(null);

  if (!access) return <Skeleton className="h-44 w-full rounded-2xl" />;

  async function pick(id: string, link?: string) {
    setOpenId(id);
    try {
      await navigator.clipboard.writeText(access!.mcpUrl);
    } catch {
      errorToast(t("Couldn't copy"));
    }
    if (link) window.open(link, "_blank", "noopener");
  }

  return (
    <div className="flex flex-col gap-3">
      {access.setup
        .filter((g) => g.id !== "other")
        .map((g) => {
          const open = openId === g.id;
          return (
            <ConnectTile
              key={g.id}
              icon={Bot}
              title={g.label}
              hint={
                connected && open
                  ? t("Connected")
                  : open
                    ? t("Link copied")
                    : undefined
              }
              state={connected && open ? "done" : "idle"}
              onClick={() => void pick(g.id, g.link?.url)}
            >
              {open && !connected && (
                <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <span
                      aria-hidden
                      className="size-2 animate-pulse rounded-full bg-primary"
                    />
                    {t("Waiting")}
                    {g.link && (
                      <a
                        href={g.link.url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-auto inline-flex items-center gap-1 font-semibold text-primary"
                      >
                        <ExternalLink className="size-3.5" aria-hidden />
                        {t("Open")}
                      </a>
                    )}
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 font-semibold text-primary"
                      onClick={() =>
                        void navigator.clipboard.writeText(access.mcpUrl)
                      }
                    >
                      <Copy className="size-3.5" aria-hidden />
                      {t("Copy link")}
                    </button>
                  </div>
                </div>
              )}
            </ConnectTile>
          );
        })}
    </div>
  );
}
