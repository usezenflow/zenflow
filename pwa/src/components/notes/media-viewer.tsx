import { useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { DialogContent, Dialog, DialogTitle } from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

interface Zoom {
  scale: number;
  x: number;
  y: number;
}

const REST: Zoom = { scale: 1, x: 0, y: 0 };

/**
 * Full-screen view of a note image or video. Images zoom with the wheel,
 * double-click toggles, and drag pans when zoomed. Videos play with their controls.
 */
export function MediaViewer({
  kind,
  src,
  alt,
  onOpenChange,
}: {
  kind: "image" | "video";
  src: string;
  alt: string;
  onOpenChange: (open: boolean) => void;
}) {
  useLanguage();
  const [zoom, setZoom] = useState<Zoom>(REST);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  function onWheel(e: WheelEvent) {
    setZoom((z) => ({
      ...z,
      scale: Math.min(MAX_SCALE, Math.max(1, z.scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1))),
    }));
  }

  function onDoubleClick() {
    setZoom((z) => (z.scale > 1 ? REST : { scale: DOUBLE_TAP_SCALE, x: 0, y: 0 }));
  }

  function onPointerDown(e: PointerEvent<HTMLImageElement>) {
    if (zoom.scale <= 1) return;
    drag.current = { px: e.clientX, py: e.clientY, x: zoom.x, y: zoom.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent<HTMLImageElement>) {
    const start = drag.current;
    if (!start) return;
    setZoom((z) => ({
      ...z,
      x: start.x + e.clientX - start.px,
      y: start.y + e.clientY - start.py,
    }));
  }

  function onPointerUp() {
    drag.current = null;
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="inset-0 top-0 left-0 h-dvh w-dvw max-w-none translate-x-0 translate-y-0 items-center justify-center rounded-none border-0 bg-foreground/95 p-0 text-background sm:max-w-none">
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {kind === "image" ? (
          <div className="flex h-full w-full items-center justify-center overflow-hidden">
            <img
              src={src}
              alt={alt}
              draggable={false}
              onWheel={onWheel}
              onDoubleClick={onDoubleClick}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                cursor: zoom.scale > 1 ? "grab" : "zoom-in",
              }}
              className="max-h-[90dvh] max-w-[90dvw] touch-none object-contain select-none"
            />
          </div>
        ) : (
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="max-h-[90dvh] max-w-[90dvw]"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
