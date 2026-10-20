import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AccountSettings } from "@/components/settings/account-settings";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Scroll to the LMS and portal section when the sheet opens. */
  focusLms?: boolean;
}

/** The Me screen as a sheet: one scroll, in the same order as mobile. */
export function SettingsDialog({ open, onOpenChange, focusLms = false }: SettingsDialogProps) {
  const isMobile = useIsMobile();
  useLanguage();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn(
          "flex flex-col gap-0 p-0",
          isMobile ? "h-[92vh] rounded-t-2xl" : "w-full sm:max-w-md",
        )}
      >
        <SheetHeader className="border-b border-border px-5 py-4 text-left">
          <SheetTitle>{t("Me")}</SheetTitle>
          <SheetDescription className="sr-only">{t("Profile, preferences and account.")}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10">
          <AccountSettings focusLms={focusLms} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
