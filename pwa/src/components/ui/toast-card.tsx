import {
  Bell,
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX,
  CircleAlert,
  CircleCheck,
  Info,
  Lightbulb,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast as sonner, useSonner } from "sonner";
import { SESSION_TONES } from "@zenflow/core";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type ToastVariant = "default" | "info" | "destructive" | "warning" | "success" | "tip";

/** Icons a caller can name, so call sites stay free of icon imports. */
export const TOAST_ICONS = {
  "calendar-check": CalendarCheck,
  "calendar-clock": CalendarClock,
  "calendar-plus": CalendarPlus,
  "calendar-x": CalendarX,
  bell: Bell,
  lightbulb: Lightbulb,
  sparkles: Sparkles,
  trash: Trash2,
} as const;

export type ToastIconName = keyof typeof TOAST_ICONS;
export type ToastAccent = { light: string; dark: string };

const VARIANTS: Record<ToastVariant, { icon: LucideIcon; accent: ToastAccent }> = {
  default: { icon: Info, accent: SESSION_TONES.lecture.ink },
  info: { icon: Info, accent: SESSION_TONES.lecture.ink },
  destructive: { icon: CircleAlert, accent: SESSION_TONES.late.ink },
  warning: { icon: TriangleAlert, accent: SESSION_TONES.assignment.ink },
  success: { icon: CircleCheck, accent: SESSION_TONES.done.ink },
  tip: { icon: Sparkles, accent: SESSION_TONES.task.ink },
};

export const DEFAULT_DURATION = 4000;
export const ERROR_DURATION = 6000;

/** Whether the stack is fanned out. Click-driven, like mobile. */
let expanded = false;
const listeners = new Set<() => void>();
export function setToastExpanded(next: boolean) {
  if (expanded === next) return;
  expanded = next;
  listeners.forEach((l) => l());
}
export function useToastExpanded(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => expanded,
    () => false,
  );
}

/** Ids `Clear all` leaves alone: prompts that wait for an answer. */
const KEEP_IDS = new Set<string>(["schedule-infeasible"]);

const StackContext = createContext<{ ids: (string | number)[] }>({ ids: [] });

/** Feeds each card the live stack order (newest first). Mount once around the toaster. */
export function ToastStackProvider({ children }: { children: ReactNode }) {
  const { toasts } = useSonner();
  const ids = toasts.filter((x) => !x.delete).map((x) => x.id);
  return <StackContext.Provider value={{ ids }}>{children}</StackContext.Provider>;
}

export interface ToastCardProps {
  id: string | number;
  title: string;
  description?: ReactNode;
  variant?: ToastVariant;
  icon?: ToastIconName | LucideIcon;
  accent?: ToastAccent;
  /** Classes for the icon badge. Replaces the accent tint. */
  badgeClassName?: string;
  /** ms before auto dismiss; the clock runs only on the front toast. */
  duration?: number;
  persistent?: boolean;
  action?: { label: string; onClick: () => void };
  cancel?: { label: string; onClick: () => void };
  /** Makes the whole card tappable. */
  onPress?: () => void;
  onDismiss?: () => void;
}

export function ToastCard(props: ToastCardProps) {
  const {
    id,
    title,
    description,
    variant = "default",
    accent,
    badgeClassName,
    persistent,
    action,
    cancel,
    onPress,
  } = props;
  const base = VARIANTS[variant];
  const Icon =
    typeof props.icon === "string" ? TOAST_ICONS[props.icon] : (props.icon ?? base.icon);
  const duration =
    props.duration ?? (variant === "destructive" ? ERROR_DURATION : DEFAULT_DURATION);
  const autoDismiss = !persistent && Number.isFinite(duration) && duration > 0;

  const { ids } = useContext(StackContext);
  const isExpanded = useToastExpanded();
  const front = ids[0] === id;
  const count = ids.length;
  const running = autoDismiss && front && !isExpanded;

  // Only the front toast's clock runs; the others keep what is left.
  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef(0);
  useEffect(() => {
    if (!running) return;
    const startedAt = performance.now();
    const left = Math.max(100, duration - elapsedRef.current);
    const timer = setTimeout(() => sonner.dismiss(id), left);
    return () => {
      clearTimeout(timer);
      elapsedRef.current += performance.now() - startedAt;
      setElapsed(elapsedRef.current);
    };
  }, [running, duration, id]);

  const left = Math.max(0, duration - elapsed);
  const tint = accent ?? base.accent;
  const dark = document.documentElement.classList.contains("dark");
  const ink = dark ? tint.dark : tint.light;

  const dismiss = () => {
    props.onDismiss?.();
    sonner.dismiss(id);
  };

  const body = (
    <>
      <span
        aria-hidden
        className={cn(
          "flex size-[30px] shrink-0 items-center justify-center rounded-xl",
          badgeClassName,
        )}
        style={badgeClassName ? undefined : { backgroundColor: `${ink}22`, color: ink }}
      >
        <Icon className="size-[17px]" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span className="block text-[13.5px] leading-snug font-semibold text-foreground">
          {title}
        </span>
        {description ? (
          <span className="mt-0.5 block text-[12.5px] leading-snug text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </>
  );

  return (
    <div className="flex w-[min(28rem,calc(100vw-2rem))] flex-col gap-2">
      {front && count > 1 ? (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setToastExpanded(!isExpanded)}
            className="glass-notice rounded-full px-3 py-1 text-[12px] font-semibold text-foreground"
          >
            {isExpanded ? t("Show less") : t("{count} notifications", { count })}
          </button>
          <button
            type="button"
            onClick={() => {
              for (const x of ids) if (!KEEP_IDS.has(String(x))) sonner.dismiss(x);
              setToastExpanded(false);
            }}
            className="glass-notice rounded-full px-3 py-1 text-[12px] font-semibold text-foreground"
          >
            {t("Clear all")}
          </button>
        </div>
      ) : null}
      <div className="glass-notice relative overflow-hidden rounded-2xl">
        <div className="flex items-start gap-3 px-3.5 py-3">
          {onPress ? (
            <button type="button" onClick={onPress} className="flex min-w-0 flex-1 items-start gap-3">
              {body}
            </button>
          ) : (
            <div className="flex min-w-0 flex-1 items-start gap-3">{body}</div>
          )}
          {!persistent ? (
            <button
              type="button"
              aria-label={t("Dismiss notification")}
              onClick={dismiss}
              className="-mr-1 shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          ) : null}
        </div>
        {action || cancel ? (
          <div className="flex justify-end gap-2 px-3.5 pb-3">
            {cancel ? (
              <button
                type="button"
                onClick={() => {
                  cancel.onClick();
                  sonner.dismiss(id);
                }}
                className="rounded-lg bg-muted px-3 py-1.5 text-[12.5px] font-semibold text-muted-foreground"
              >
                {cancel.label}
              </button>
            ) : null}
            {action ? (
              <button
                type="button"
                onClick={() => {
                  action.onClick();
                  sonner.dismiss(id);
                }}
                className="rounded-lg bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground"
              >
                {action.label}
              </button>
            ) : null}
          </div>
        ) : null}
        {autoDismiss ? (
          <span
            key={elapsed}
            aria-hidden
            className="zf-toast-bar absolute inset-x-0 bottom-0 h-[3px] origin-left"
            style={
              {
                backgroundColor: ink,
                animationDuration: `${left}ms`,
                animationPlayState: running ? "running" : "paused",
                "--from": left / duration,
              } as React.CSSProperties
            }
          />
        ) : null}
      </div>
    </div>
  );
}
