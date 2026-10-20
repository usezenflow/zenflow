import { ImageIcon } from "lucide-react";
import { useState } from "react";
import { MediaStatus } from "@/components/notes/media-status";
import { MediaViewer } from "@/components/notes/media-viewer";
import { useOnline } from "@/components/notes/use-note-media";
import { t, useLanguage } from "@/lib/i18n";
import { isDataUri } from "@/lib/notes/media";
import { cn } from "@/lib/utils";

/**
 * Inline image; a click opens it in the zoomable viewer. A failed load shows a
 * placeholder that retries on click.
 */
export function ImageView({ src, alt }: { src: string; alt: string }) {
  useLanguage();
  const online = useOnline();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);

  const offline = !online && !isDataUri(src);

  if (offline || failed) {
    const retry = () => {
      setFailed(false);
      setAttempt((n) => n + 1);
    };
    return (
      <div
        role={offline ? undefined : "button"}
        tabIndex={offline ? undefined : 0}
        onClick={offline ? undefined : retry}
        onKeyDown={
          offline ? undefined : (e) => e.key === "Enter" && retry()
        }
        className={cn(
          "my-2 flex h-42.5 w-full flex-col items-center justify-center gap-2 rounded-xl bg-muted text-muted-foreground",
          !offline && "cursor-pointer",
        )}
      >
        <ImageIcon className="size-10" strokeWidth={1.6} aria-hidden />
        <MediaStatus offline={offline} />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-label={t("Open image")}
        onClick={() => setOpen(true)}
        className="my-2 block max-w-full cursor-zoom-in"
      >
        <img
          key={attempt}
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="max-h-80 max-w-full rounded-lg object-contain"
        />
      </button>
      {open && (
        <MediaViewer kind="image" src={src} alt={alt} onOpenChange={setOpen} />
      )}
    </>
  );
}
