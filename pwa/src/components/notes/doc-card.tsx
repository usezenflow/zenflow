import { Download } from "lucide-react";
import { useState } from "react";
import { useFileSize, useOnline } from "@/components/notes/use-note-media";
import { MediaStatus } from "@/components/notes/media-status";
import { errorToast } from "@/lib/toast";
import { downloadNoteFile } from "@/lib/notes/download";
import {
  DEFAULT_DOC_COLOR,
  DOC_COLORS,
  fileExtension,
  formatBytes,
  isDataUri,
} from "@/lib/notes/media";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** A stored file as a card: a file-type tile with its extension, the name, the size and a download glyph. */
export function DocCard({ href, name }: { href: string; name: string }) {
  useLanguage();
  const online = useOnline();
  const size = useFileSize(href);
  const [busy, setBusy] = useState(false);

  const ext = fileExtension(name);
  const offline = !online && !isDataUri(href);
  const color = DOC_COLORS[ext] ?? DEFAULT_DOC_COLOR;

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      await downloadNoteFile(href, name);
    } catch {
      errorToast(t("Couldn't open file"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      disabled={offline}
      onClick={() => void download()}
      className={cn(
        "my-2 flex w-full items-center gap-3 rounded-2xl border border-border bg-muted/40 px-3.5 py-3 text-left text-foreground transition-colors hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-muted/40",
      )}
    >
      <span
        className="relative flex h-12 w-10 flex-none items-end justify-center pb-2.25"
        style={{ color }}
        aria-hidden
      >
        <svg
          viewBox="0 0 40 48"
          className="absolute inset-0 size-full fill-none stroke-current"
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M8 2h16l10 10v32a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z" />
          <path d="M24 2v10h10" />
        </svg>
        <b className="relative text-[11px] font-extrabold tracking-wide">
          {(ext || "file").toUpperCase().slice(0, 4)}
        </b>
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="line-clamp-2 text-[15px] leading-snug font-semibold break-words">
          {name}
        </span>
        {offline ? (
          <MediaStatus offline />
        ) : (
          size !== null && (
            <span className="text-xs text-muted-foreground">
              {formatBytes(size)}
            </span>
          )
        )}
      </span>
      <Download className="size-5 flex-none text-muted-foreground" aria-hidden />
    </button>
  );
}
