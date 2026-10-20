import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ComponentProps } from "react";

/**
 * A round frosted icon button for floating chrome, the web twin of mobile's
 * `GlassButton`. Only for chrome such as a sheet header, never for content.
 */
export function GlassIconButton({
  icon: Icon,
  label,
  destructive = false,
  className,
  ...props
}: ComponentProps<"button"> & { icon: LucideIcon; label: string; destructive?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "glass-frosted flex size-10 shrink-0 items-center justify-center rounded-full transition-transform enabled:active:scale-95 disabled:opacity-40",
        destructive ? "text-destructive" : "text-foreground",
        className,
      )}
      {...props}
    >
      <Icon className="size-[18px]" />
    </button>
  );
}
