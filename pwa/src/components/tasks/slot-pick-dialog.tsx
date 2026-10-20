import { useState } from "react";
import { format } from "@/lib/format";
import { toast } from "@/lib/notify";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, errorToast } from "@/lib/toast";
import { t } from "@/lib/i18n";
import { zonedDate } from "@/utils/tz";
import { slotPick } from "@/api/tasks";
import type { Session } from "@zenflow/shared";

interface SlotPickDialogProps {
  open: boolean;
  sessionId: string;
  slotProposalId: string;
  primarySlot: string;
  alternativeSlot: string;
  /** Session title, shown for context. */
  title: string;
  tz: string;
  /** Fires once the pick is saved. */
  onResolved: (session: Session) => void;
  /**
   * Fires when the dialog closes without a pick. The primary slot is already
   * applied, so closing keeps it.
   */
  onDismiss: () => void;
}

/** "09:00, Mon 12 Oct": the time first, then the day. */
const slotLabel = (iso: string, tz: string) =>
  format(zonedDate(iso, tz), "HH:mm, EEE d MMM");

/**
 * Shown after a divergent A/B slot proposal. The first choice is already
 * applied, so "Keep" and closing the dialog both leave it in place. "Prefer"
 * switches the session to the alternative and records the pick.
 */
export function SlotPickDialog({
  open,
  sessionId,
  slotProposalId,
  primarySlot,
  alternativeSlot,
  title,
  tz,
  onResolved,
  onDismiss,
}: SlotPickDialogProps) {
  const [loading, setLoading] = useState(false);

  function keepPrimary() {
    setLoading(false);
    onDismiss();
  }

  async function preferAlternative() {
    setLoading(true);
    try {
      const { session } = await slotPick(sessionId, {
        slotProposalId,
        chose: "alternative",
      });
      toast.success(t("Moved to the new time"), {
      icon: "calendar-clock",
        description: t("Your pick is saved. Zenflow will remember it."),
      });
      setLoading(false);
      onResolved(session);
    } catch (error) {
      errorToast(t("Couldn't switch the time"), {
        description: apiErrorMessage(
          error,
          t("The slot may have been taken. Keep the original time or try again."),
        ),
      });
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !loading) keepPrimary();
      }}
    >
      <DialogContent className="gap-6 p-6 sm:max-w-md">
        <DialogHeader className="gap-2">
          <DialogTitle className="text-lg">
            {t("Two good times for this")}
          </DialogTitle>
          <DialogDescription className="text-sm">
            {title ? `"${title}" ` : ""}
            {t("fits either time. Pick the one that suits you.")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button
            size="lg"
            disabled={loading}
            onClick={keepPrimary}
            className="h-14 w-full rounded-xl text-base font-semibold sm:flex-1"
          >
            {t("Keep {time}", { time: slotLabel(primarySlot, tz) })}
          </Button>
          <Button
            size="lg"
            variant="outline"
            disabled={loading}
            onClick={preferAlternative}
            className="h-14 w-full rounded-xl border-2 border-primary text-base font-semibold text-primary hover:bg-primary/10 hover:text-primary sm:flex-1"
          >
            {t("Prefer {time}", { time: slotLabel(alternativeSlot, tz) })}
          </Button>
        </div>

        <p className="text-center text-xs leading-relaxed text-muted-foreground">
          {t("Your pick helps Zenflow learn which times work for you. It never moves anything else.")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
