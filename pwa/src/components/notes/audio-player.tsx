import { Pause, Play } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { MediaStatus } from "@/components/notes/media-status";
import { startPlayback } from "@/components/notes/playback";
import { useOnline } from "@/components/notes/use-note-media";
import { t, useLanguage } from "@/lib/i18n";
import { formatDuration, isDataUri } from "@/lib/notes/media";
import { cn } from "@/lib/utils";

const RATES = [1, 1.25, 1.5, 2];

/**
 * Audio card: a play disc, a progress bar you can scrub, a speed chip. The bar
 * shows progress, not a waveform, since the file isn't analysed.
 */
export function AudioPlayer({ src }: { src: string }) {
  useLanguage();
  const online = useOnline();
  const audio = useRef<HTMLAudioElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const scrubbing = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRate] = useState(0);

  const offline = !online && !isDataUri(src);
  const dead = offline || failed;
  const fraction = duration > 0 ? Math.min(1, time / duration) : 0;

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) startPlayback(el);
    else el.pause();
  }

  function cycleRate() {
    const next = (rate + 1) % RATES.length;
    setRate(next);
    if (audio.current) audio.current.playbackRate = RATES[next];
  }

  function seek(e: PointerEvent<HTMLDivElement>) {
    const el = audio.current;
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
      onKeyDown={
        failed ? (e) => e.key === "Enter" && retry() : undefined
      }
      className={cn(
        "relative my-2 flex items-center gap-3 rounded-[20px] border border-border bg-muted/40 px-3.5 py-3",
        failed && "cursor-pointer",
      )}
    >
      <button
        type="button"
        disabled={dead}
        aria-label={playing ? t("Pause") : t("Play")}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className="flex size-13 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground ring-4 ring-primary/20 disabled:opacity-45"
      >
        {playing ? (
          <Pause className="size-6 fill-current" />
        ) : (
          <Play className="size-6 fill-current" />
        )}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div
          ref={track}
          role="slider"
          aria-label={t("Seek")}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          onPointerDown={(e) => {
            if (dead) return;
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
          className="flex h-4 touch-none items-center"
        >
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-foreground/15">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-primary"
              style={{ width: `${fraction * 100}%` }}
            />
          </div>
        </div>
        <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
          <span>{formatDuration(time)}</span>
          <span>{duration > 0 ? formatDuration(duration) : "--:--"}</span>
        </div>
      </div>
      <button
        type="button"
        disabled={dead}
        aria-label={t("Playback speed")}
        onClick={(e) => {
          e.stopPropagation();
          cycleRate();
        }}
        className="w-14 flex-none rounded-full border border-border py-1 text-xs font-semibold text-foreground tabular-nums disabled:opacity-45"
      >
        {RATES[rate]}x
      </button>
      {dead && (
        <MediaStatus offline={offline} className="absolute top-2 right-3.5" />
      )}
      {!dead && (
        <audio
          key={attempt}
          ref={audio}
          src={src}
          preload="metadata"
          hidden
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            setTime(0);
          }}
          onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            e.currentTarget.playbackRate = RATES[rate];
          }}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
