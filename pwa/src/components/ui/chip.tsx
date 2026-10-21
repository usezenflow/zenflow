import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/** A tap target sized for a thumb: 40px tall. */
export function Chip({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3.5 text-[14px] font-medium transition-colors disabled:opacity-40",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground enabled:hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
