import type { ComponentProps, ReactNode } from "react";
import { View } from "react-native";
import { Spinner } from "@/components/ui/spinner";
import { useDelayedLoading } from "@/hooks/use-delayed-loading";

type SpinnerProps = ComponentProps<typeof Spinner>;

/** A spinner that only appears once `busy` has lasted past the loading delay. */
export function DelayedSpinner({
  busy,
  wrapperClassName,
  ...spinner
}: SpinnerProps & { busy: boolean; wrapperClassName?: string }) {
  const show = useDelayedLoading(busy);
  if (!show) return null;
  const mark = <Spinner {...spinner} />;
  return wrapperClassName ? <View className={wrapperClassName}>{mark}</View> : mark;
}

/** Shows `children` until `busy` has lasted past the loading delay, then a spinner. */
export function BusyOr({
  busy,
  children,
  ...spinner
}: SpinnerProps & { busy: boolean; children: ReactNode }) {
  const show = useDelayedLoading(busy);
  return show ? <Spinner {...spinner} /> : children;
}
