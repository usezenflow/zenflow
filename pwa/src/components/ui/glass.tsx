import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

/**
 * Sunrise Flow glass, the web twin of mobile's `Glass`. `frosted` is the
 * see-through blur over the page; the default is the solid warm surface for
 * floating chrome. Tints and edges live in index.css (`.glass`, `.glass-frosted`).
 */
export function Glass({
  frosted = false,
  className,
  ...props
}: ComponentProps<"div"> & { frosted?: boolean }) {
  return (
    <div
      className={cn(frosted ? "glass-frosted" : "glass", "rounded-xl", className)}
      {...props}
    />
  );
}
