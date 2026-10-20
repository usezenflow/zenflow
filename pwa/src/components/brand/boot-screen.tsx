import { t } from "@/lib/i18n";
import { Logo } from "@/components/logo";
import { SunriseBackdrop } from "@/components/brand/sunrise-backdrop";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";

/** Full-screen loading state: the logo with the curve turning, while the session is checked. */
export function BootScreen() {
  return (
    <div
      role="status"
      aria-label={t("Loading")}
      className="relative flex h-svh flex-col items-center justify-center gap-6 overflow-hidden bg-background"
    >
      <SunriseBackdrop />
      <Logo className="relative size-20" />
      <DelayedSpinner busy className="relative size-5 text-primary" />
    </div>
  );
}
