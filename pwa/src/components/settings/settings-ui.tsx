import type { ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/** Sentence-case label above a grouped settings card. */
export function SettingsLabel({ children }: { children: string }) {
  return (
    <h3 className="mx-1 mb-2 mt-[22px] text-[13px] font-semibold text-muted-foreground">
      {children}
    </h3>
  );
}

export function SettingsCard({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Divider() {
  return <div className="h-px bg-border" />;
}

export function IconTile({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
      <Icon className="size-[18px] text-foreground" />
    </span>
  );
}

/** A settings row. Without `onClick` it is display only. */
export function SettingsRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  value?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <IconTile icon={icon} />
      <span className="min-w-0 flex-1 text-[16px] font-semibold">{title}</span>
      {value ? (
        <span className="max-w-[55%] truncate text-[15px] font-medium text-muted-foreground">
          {value}
        </span>
      ) : null}
      {onClick ? (
        <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  if (!onClick) {
    return <div className="flex items-center gap-[13px] px-4 py-3.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-[13px] px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
    >
      {body}
    </button>
  );
}

/** Bottom sheet on mobile, side sheet on desktop. */
export function SettingsSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex max-h-[85vh] flex-col gap-0 bg-background p-0 backdrop-blur-none",
          isMobile
            ? "h-auto rounded-t-3xl pb-[env(safe-area-inset-bottom)]"
            : "top-3 right-3 bottom-auto h-auto max-h-[calc(100%-1.5rem)] w-[calc(100%-1.5rem)] rounded-3xl border shadow-2xl sm:max-w-md",
        )}
      >
        {isMobile && <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted" />}
        <SheetHeader className="gap-0.5 border-b border-border px-6 py-4 pr-14 text-left">
          <SheetTitle className="text-[18px] font-bold tracking-tight">{title}</SheetTitle>
          <SheetDescription className={description ? undefined : "sr-only"}>
            {description ?? title}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
