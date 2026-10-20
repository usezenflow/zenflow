import { useEffect } from "react";
import { Toaster as Sonner, ToasterProps } from "sonner";
import { setToastExpanded, ToastStackProvider, useToastExpanded } from "@/components/ui/toast-card";

const TOASTER = "[data-sonner-toaster]";

/**
 * Toasts pile up collapsed (only the newest is fully visible) and fan out when
 * the pile is *clicked*, not on hover, which is sonner's default. Sonner has no
 * controlled "expanded" state, so the click state lives in `toast-card.tsx` and
 * drives its `expand` prop; hover events inside the toaster are swallowed before
 * sonner's hover-to-expand handler can see them.
 */
function useClickToExpand() {
  useEffect(() => {
    const inToaster = (e: Event) =>
      e.target instanceof Element && e.target.closest(TOASTER) !== null;
    const onClick = (e: MouseEvent) => {
      // The count pill and the cards toggle it themselves.
      if (!inToaster(e)) setToastExpanded(false);
      else if (!(e.target as Element).closest("button")) setToastExpanded(true);
    };
    const blockHover = (e: Event) => {
      if (inToaster(e)) e.stopPropagation();
    };
    document.addEventListener("click", onClick);
    const hover = ["mouseover", "mouseout", "mousemove"] as const;
    for (const t of hover) window.addEventListener(t, blockHover, true);
    return () => {
      document.removeEventListener("click", onClick);
      for (const t of hover) window.removeEventListener(t, blockHover, true);
    };
  }, []);
  return useToastExpanded();
}

const Toaster = ({ ...props }: ToasterProps) => {
  // The app has no next-themes provider (dark mode is just the `.dark` class),
  // so follow the page's own class instead of the OS.
  const theme = document.documentElement.classList.contains("dark") ? "dark" : "light";
  const expanded = useClickToExpand();

  return (
    <ToastStackProvider>
      <Sonner
        theme={theme}
        position="bottom-right"
        className="toaster group"
        expand={expanded}
        // Every toast is a `ToastCard` that runs its own clock (front toast only).
        duration={Infinity}
        style={
          {
            fontFamily: '"Geist", "Geist Fallback", system-ui, sans-serif',
            "--width": "28rem",
          } as React.CSSProperties
        }
        {...props}
      />
    </ToastStackProvider>
  );
};

export { Toaster };
