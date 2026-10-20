import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { toast as sonner } from "sonner";
import {
  ToastCard,
  type ToastAccent,
  type ToastIconName,
  type ToastVariant,
} from "@/components/ui/toast-card";

export interface ToastOptions {
  id?: string | number;
  description?: ReactNode;
  icon?: ToastIconName | LucideIcon;
  accent?: ToastAccent;
  badgeClassName?: string;
  /** ms; `Infinity` keeps it until dismissed. */
  duration?: number;
  action?: { label: string; onClick: () => void };
  cancel?: { label: string; onClick: () => void };
  onPress?: () => void;
  onDismiss?: () => void;
}

function show(variant: ToastVariant, title: string, opts: ToastOptions = {}) {
  const { duration, id, onDismiss, ...rest } = opts;
  const persistent = duration === Infinity;
  return sonner.custom(
    (toastId) => (
      <ToastCard
        id={toastId}
        title={title}
        variant={variant}
        duration={persistent ? undefined : duration}
        persistent={persistent}
        onDismiss={onDismiss}
        {...rest}
      />
    ),
    { id, duration: Infinity, onDismiss },
  );
}

/** The app's toast, same look and stack as mobile. Title is short and verb first; detail goes in `description`. */
export const toast = Object.assign(
  (title: string, opts?: ToastOptions) => show("default", title, opts),
  {
    success: (title: string, opts?: ToastOptions) => show("success", title, opts),
    info: (title: string, opts?: ToastOptions) => show("info", title, opts),
    warning: (title: string, opts?: ToastOptions) => show("warning", title, opts),
    error: (title: string, opts?: ToastOptions) => show("destructive", title, opts),
    tip: (title: string, opts?: ToastOptions) => show("tip", title, opts),
    custom: sonner.custom,
    dismiss: sonner.dismiss,
  },
);
