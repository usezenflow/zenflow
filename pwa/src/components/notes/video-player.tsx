import { Maximize2, Pause, Play } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { MediaStatus } from "@/components/notes/media-status";
import { MediaViewer } from "@/components/notes/media-viewer";
import { startPlayback } from "@/components/notes/playback";
import { useOnline } from "@/components/notes/use-note-media";
import { t, useLanguage } from "@/lib/i18n";
import { formatDuration, isDataUri } from "@/lib/notes/media";
import { cn } from "@/lib/utils";

/**
 * Video with a poster (its first frame, loaded as metadata), a centre play button
 * and a control bar: time, a scrub track, and full screen.
 */
export function VideoPlayer({ src }: { src: string }) {
  useLanguage();
  const online = useOnline();
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const offline = !online && !isDataUri(src);
  const dead = offline || failed;
  const fraction = duration > 0 ? Math.min(1, time / duration) : 0;

  function toggle() {
    const el = video.current;
    if (!el) return;
    if (el.paused) startPlayback(el);
    else el.pause();
  }

  function seek(e: PointerEvent<HTMLDivElement>) {
    const el = video.current;
    const bar = track.current;
    if (!el || !bar || !Number.isFinite(el.duration)) return;
    const box = bar.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    el.currentTime = p * el.duration;
    setTime(el.currentTime);
  }

  function retry() {
    setFailed(false);
    setAttempt((n) => n + 1);
  }

  return (
    <div
      role={failed ? "button" : undefined}
      tabIndex={failed ? 0 : undefined}
      onClick={failed ? retry : undefined}
      onKeyDown={failed ? (e) => e.key === "Enter" && retry() : undefined}
      className={cn(
        "group relative my-2 aspect-video max-h-80 w-full overflow-hidden rounded-[20px] bg-foreground text-background",
        failed && "cursor-pointer",
      )}
    >
      {!dead && (
        <video
          key={attempt}
          ref={video}
          src={src}
          preload="metadata"
          playsInline
          className="size-full object-contain"
          onClick={toggle}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
          onError={() => setFailed(true)}
        />
      )}
      {!dead && (
        <button
          type="button"
          aria-label={playing ? t("Pause") : t("Play")}
          onClick={toggle}
          className={cn(
            "absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-primary/30 transition-opacity",
            playing && "opacity-0 group-hover:opacity-100 focus:opacity-100",
          )}
        >
          {playing ? (
            <Pause className="size-6 fill-current" />
          ) : (
            <Play className="size-6 fill-current" />
          )}
        </button>
      )}
      {dead && (
        <>
          <button
            type="button"
            disabled
            aria-label={t("Play")}
            className="absolute top-1/2 left-1/2 flex size-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-45"
          >
            <Play className="size-6 fill-current" />
          </button>
          <MediaStatus
            offline={offline}
            className="absolute bottom-2.5 left-3 text-background"
          />
        </>
      )}
      {!dead && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-linear-to-t from-foreground/70 to-transparent px-3 pt-6 pb-2.5 text-xs text-background tabular-nums">
          <span>{formatDuration(time)}</span>
          <div
            ref={track}
            role="slider"
            aria-label={t("Seek")}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration)}
            aria-valuenow={Math.round(time)}
            onPointerDown={(e) => {
              scrubbing.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              seek(e);
            }}
            onPointerMove={(e) => {
              if (scrubbing.current) seek(e);
            }}
            onPointerUp={() => {
              scrubbing.current = false;
            }}
            onPointerCancel={() => {
              scrubbing.current = false;
            }}
            className="flex h-4 flex-1 touch-none items-center"
          >
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-background/30">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary"
                style={{ width: `${fraction * 100}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            aria-label={t("Full screen")}
            onClick={(e) => {
              e.stopPropagation();
              video.current?.pause();
              setFullscreen(true);
            }}
            className="flex-none"
          >
            <Maximize2 className="size-4" />
          </button>
        </div>
      )}
      {fullscreen && (
        <MediaViewer
          kind="video"
          src={src}
          alt={t("Full screen")}
          onOpenChange={setFullscreen}
        />
      )}
    </div>
  );
}
