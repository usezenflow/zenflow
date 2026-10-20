import type { ReactNode } from "react";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";

/** A spinner that only appears once `busy` has lasted past the loading delay. */
export function DelayedSpinner({ busy, className }: { busy: boolean; className?: string }) {
  const show = useDelayedLoading(busy);
  return show ? <Spinner className={className} /> : null;
}

/** Shows `children` until `busy` has lasted past the loading delay, then a spinner. */
export function BusyOr({
  busy,
  className,
  children,
}: {
  busy: boolean;
  className?: string;
  children: ReactNode;
}) {
  const show = useDelayedLoading(busy);
  return show ? <Spinner className={className} /> : children;
}
