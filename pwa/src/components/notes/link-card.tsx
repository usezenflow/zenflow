import { ExternalLink, Link2 } from "lucide-react";
import { useState } from "react";
import { useLinkPreview } from "@/components/notes/use-note-media";
import { useLanguage } from "@/lib/i18n";
import { hostOf } from "@/lib/notes/media";
import { cn } from "@/lib/utils";

const CARD =
  "my-2 flex flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground transition-colors hover:bg-muted/40";

/**
 * A link that is the whole of its line: an unfurl with cover image, title,
 * description and site when the page has metadata, otherwise a compact card.
 */
export function LinkCard({ href, text }: { href: string; text: string }) {
  useLanguage();
  const preview = useLinkPreview(href);
  const [imageFailed, setImageFailed] = useState(false);

  if (preview === undefined) {
    return (
      <div className={cn(CARD, "animate-pulse")} aria-hidden>
        <div className="flex gap-3 p-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-3 w-2/3 rounded-full bg-muted" />
            <div className="h-3 w-full rounded-full bg-muted" />
            <div className="h-3 w-2/5 rounded-full bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const host = hostOf(href);
  const isUrl = /^https?:\/\//i.test(text);
  const title = preview?.title || (isUrl ? host : text);
  const site = preview?.siteName || host;
  const image = !imageFailed && preview?.image ? preview.image : null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(CARD, "text-foreground no-underline")}
    >
      {image && (
        <img
          src={image}
          alt=""
          onError={() => setImageFailed(true)}
          className="aspect-[1.91/1] w-full bg-muted object-cover"
        />
      )}
      <span className="flex items-center gap-3 p-3.5">
        {!image && (
          <span className="flex size-9 flex-none items-center justify-center rounded-[10px] bg-primary text-primary-foreground">
            <Link2 className="size-4.5" aria-hidden />
          </span>
        )}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="line-clamp-2 text-[15px] leading-snug font-semibold break-words">
            {title}
          </span>
          {preview?.description && (
            <span className="line-clamp-2 text-sm leading-snug text-muted-foreground">
              {preview.description}
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">{site}</span>
        </span>
        <ExternalLink className="size-4 flex-none text-muted-foreground" aria-hidden />
      </span>
    </a>
  );
}
