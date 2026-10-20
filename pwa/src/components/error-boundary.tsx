import { Component, type ErrorInfo, type ReactNode } from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches render errors so one broken screen shows a recovery card instead of
 * a blank app. React only exposes error boundaries as class components.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-destructive/15 text-destructive">
          <TriangleAlertIcon className="size-5" aria-hidden />
        </span>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-semibold">{t("Something went wrong")}</h1>
          <p className="text-sm text-muted-foreground">{t("Reload the page to try again.")}</p>
        </div>
        <Button onClick={() => window.location.reload()}>{t("Reload")}</Button>
      </div>
    );
  }
}
