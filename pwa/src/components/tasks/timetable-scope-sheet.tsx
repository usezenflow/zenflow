import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type TimetableScope = "occurrence" | "following" | "all";

const OPTIONS: { scope: TimetableScope; label: string; hint: string }[] = [
  {
    scope: "occurrence",
    label: "This occurrence",
    hint: "Only this meeting is skipped.",
  },
  {
    scope: "following",
    label: "This and all following",
    hint: "Skipped from this meeting to the end.",
  },
  {
    scope: "all",
    label: "All occurrences",
    hint: "Skip the whole course.",
  },
];

/**
 * Three-way choice for a timetable meeting, as on mobile: this meeting, this
 * and every later one, or the whole course. Not a series control: each option
 * is one timetable call.
 */
export function TimetableScopeSheet({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (scope: TimetableScope) => void;
}) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("flex flex-col gap-4 p-6", isMobile ? "rounded-t-2xl" : "sm:max-w-md")}
      >
        <SheetHeader className="gap-1.5 text-left">
          <SheetTitle>{t("Skip recurring session")}</SheetTitle>
          <SheetDescription>{t("Choose which meetings to skip.")}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3">
          {OPTIONS.map((o) => (
            <Button
              key={o.scope}
              variant={o.scope === "all" ? "destructive" : "outline"}
              className="h-auto flex-col items-start gap-0.5 rounded-xl px-4 py-3 text-left"
              onClick={() => onChoose(o.scope)}
            >
              <span className="text-base font-semibold">{t(o.label)}</span>
              <span className="text-xs font-normal opacity-80">{t(o.hint)}</span>
            </Button>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
