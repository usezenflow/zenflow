import { ErrorMark } from "@/components/brand/state-marks";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { t } from "@/lib/i18n";

/** The calendar failed to load and there is no saved copy to show. */
export function CalendarLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <Empty className="h-full border-0">
      <EmptyHeader>
        <EmptyMedia>
          <ErrorMark />
        </EmptyMedia>
        <EmptyTitle>{t("Couldn't load your calendar")}</EmptyTitle>
        <EmptyDescription>
          {t("Check your connection and try again.")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" onClick={onRetry}>
          {t("Try again")}
        </Button>
      </EmptyContent>
    </Empty>
  );
}
