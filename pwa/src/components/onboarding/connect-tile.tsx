import type { ReactNode } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { cn } from "@/lib/utils";

export type TileState = "idle" | "busy" | "done" | "off";

/** One tap target: the whole tile is the button. Icon, short title, one line. */
export function ConnectTile({
  icon: Icon,
  title,
  hint,
  state = "idle",
  onClick,
  children,
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  state?: TileState;
  onClick?: () => void;
  children?: ReactNode;
}) {
  const done = state === "done";
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border bg-card/70 transition-colors",
        done ? "border-primary/40" : "border-border",
        state === "off" && "opacity-60",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        disabled={state === "busy" || state === "off"}
        className="flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors enabled:hover:bg-muted/50 enabled:active:scale-[0.99]"
      >
        <span
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-2xl",
            done
              ? "bg-primary text-primary-foreground"
              : "bg-primary/10 text-primary",
          )}
        >
          {done ? <Check className="size-5" /> : <Icon className="size-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">{title}</span>
          {hint && (
            <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
              {hint}
            </span>
          )}
        </span>
        <DelayedSpinner busy={state === "busy"} className="size-4" />
      </button>
      {children}
    </div>
  );
}
