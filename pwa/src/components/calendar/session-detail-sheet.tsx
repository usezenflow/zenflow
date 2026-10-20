import { postData } from "@/api";
import {
  createSession,
  getSessionDetails,
  removeSession,
  skipSession,
  skipTimetableGroup,
  skipTimetableGroupFrom,
  updateSession,
} from "@/api/tasks";
import { openPlacementPlan } from "@/components/calendar/make-room-sheet";
import { SessionEditor } from "@/components/calendar/session-editor";
import {
  type SessionForm,
  createInput,
  draftForm,
  formFromSession,
  patchFor,
} from "@/components/calendar/session-form";
import { GlassIconButton } from "@/components/ui/glass-button";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { BusyOr, DelayedSpinner } from "@/components/ui/delayed-spinner";
import { SlotPickDialog } from "@/components/tasks/slot-pick-dialog";
import {
  TimetableScopeSheet,
  type TimetableScope,
} from "@/components/tasks/timetable-scope-sheet";
import { useFilesTracker } from "@/hooks/use-files-tracker";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserStore } from "@/hooks/use-user-store";
import { getPlacementPlan } from "@/lib/make-room";
import { hideSessions } from "@/lib/hidden-sessions";
import { t, useLanguage } from "@/lib/i18n";
import { deferCommit, UNDO_WINDOW_MS } from "@/lib/undo";
import { apiErrorMessage, errorToast, notifyDisplaced, withInfeasibleRetry } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { extractFileIdsFromNoteContent } from "@/utils/files";
import { zonedDate } from "@/utils/tz";
import {
  SESSION_TONE_CLASSES,
  SESSION_TYPE_META,
  SESSION_TYPE_TONE,
  deriveState,
  sessionTone,
} from "@zenflow/core";
import type { CreateSessionInput, CreateSessionResponse, PlacementPlan, Session } from "@zenflow/shared";
import { Check, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@/lib/notify";

/** Typing saves once the user pauses for this long, as on mobile. */
const SAVE_DEBOUNCE_MS = 600;
/** How long the "Saved" pill stays after a save lands, as on mobile. */
const SAVED_PILL_MS = 1500;

/** What the sheet is showing: a new draft, or a saved session. */
export type SessionSheetTarget =
  | { kind: "draft"; deadline?: string }
  | { kind: "session"; sessionId: string };

/**
 * The session sheet: one glass surface for viewing, editing and creating. A
 * saved session autosaves each field a moment after the user stops typing. A
 * draft keeps its values until "Schedule it" places it. On mobile it opens
 * full screen, on desktop as a side sheet.
 */
export function SessionDetailSheet({
  target,
  onClose,
  onChanged,
  setDate,
}: {
  target: SessionSheetTarget | null;
  onClose: () => void;
  onChanged: () => void;
  setDate: (d: Date) => void;
}) {
  useLanguage();
  const user = useUserStore((s) => s.user);
  const tz = user?.timezone || "UTC";
  const isMobile = useIsMobile();
  const { newUploadsRef } = useFilesTracker();

  const [session, setSession] = useState<Session | null>(null);
  const [form, setForm] = useState<SessionForm>(() => draftForm("", null));
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [timetableScopeOpen, setTimetableScopeOpen] = useState(false);
  const [pendingPick, setPendingPick] = useState<CreateSessionResponse | null>(null);
  const dirty = useRef(new Set<keyof SessionForm>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Kept in step with `setForm` so a save never reads a stale value.
  const formRef = useRef(form);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const open = target !== null;

  // Load a saved session into the form whenever the sheet opens on one.
  useEffect(() => {
    if (!target) return;
    dirty.current.clear();
    setSaved(false);
    if (target.kind === "draft") {
      const next = draftForm(target.deadline ?? "", user?.defaultReminderMinutes ?? null);
      formRef.current = next;
      setSession(null);
      setForm(next);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    let cancelled = false;
    getSessionDetails(target.sessionId)
      .then((data) => {
        if (cancelled) return;
        const next = formFromSession(data, tz);
        formRef.current = next;
        setSession(data);
        setForm(next);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) errorToast(t("Couldn't load this session"));
      });
    return () => {
      cancelled = true;
    };
    // The user's defaults are read once, when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, tz]);

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  function flashSaved() {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), SAVED_PILL_MS);
  }

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const current = sessionRef.current;
    if (!current || dirty.current.size === 0) return;
    const names = new Set(dirty.current);
    dirty.current.clear();
    const patch = patchFor(names, formRef.current, current, tz);
    if (Object.keys(patch).length === 0) return;
    try {
      const updated = await updateSession(current.id, patch);
      setSession(updated);
      onChangedRef.current();
      flashSaved();
    } catch (error) {
      const plan = getPlacementPlan(error);
      if (plan) {
        void askToMakeRoom(plan);
        return;
      }
      errorToast(t("Couldn't save your changes"), {
        description: apiErrorMessage(error, t("Nothing was changed. Check the details and try again.")),
      });
    }
  }, [tz]);

  /** An edit that moves a session the user chose needs confirmation first. */
  function askToMakeRoom(plan: PlacementPlan) {
    return openPlacementPlan({
      plan,
      subtitle: t("{title} moves to this time. These sessions move to fit it.", { title: formRef.current.title }),
      title: formRef.current.title,
      durationMinutes: formRef.current.duration,
      onConfirmed: (res) => {
        setSession(res.session);
        notifyDisplaced(res);
        onChangedRef.current();
        flashSaved();
      },
      onUndone: () => onChangedRef.current(),
    });
  }

  // Edits made in the sheet land before it unmounts.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  /** Updates the form now and saves the named fields after a pause (or now, when `immediate`). */
  function update(patch: Partial<SessionForm>, names: (keyof SessionForm)[], immediate = false) {
    const next = { ...formRef.current, ...patch };
    formRef.current = next;
    setForm(next);
    if (!sessionRef.current) return;
    for (const name of names) dirty.current.add(name);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) void flush();
    else timer.current = setTimeout(() => void flush(), SAVE_DEBOUNCE_MS);
  }

  function finishCreate(created: Session) {
    if (created.scheduledStartTime) setDate(zonedDate(created.scheduledStartTime, tz));
    onChanged();
    toast.success(t("Session created"), {
      icon: "calendar-plus",
      description: t("It is on your calendar."),
    });
    onClose();
  }

  async function submitDraft() {
    const f = formRef.current;
    if (!f.title.trim()) {
      errorToast(t("Add a title"), { description: t("A session needs a name.") });
      return;
    }
    if (f.type === "TASK" && !f.deadline) {
      errorToast(t("Add a deadline"), { description: t("A plan needs a day to finish by.") });
      return;
    }
    if (f.type !== "TASK" && !f.date) {
      errorToast(t("Pick a day"), { description: t("Choose when this happens.") });
      return;
    }
    const input = createInput(f, tz);

    setLoading(true);
    try {
      const created = await withInfeasibleRetry((infeasiblePolicy) =>
        createSession(infeasiblePolicy ? ({ ...input, infeasiblePolicy } as CreateSessionInput) : input),
      );
      if (!created) return; // dismissed the infeasible prompt
      notifyDisplaced(created);
      newUploadsRef.current = [];
      if (created.divergent && created.slotProposalId && created.alternativeSlot) {
        setPendingPick(created);
      } else {
        finishCreate(created);
      }
    } catch (error) {
      const plan = getPlacementPlan(error);
      if (plan) {
        void askToMakeRoomForDraft(plan, f);
        return;
      }
      errorToast(t("Couldn't create the session"), {
        description: apiErrorMessage(
          error,
          t("Something went wrong on our end. Check your details and try again."),
        ),
      });
    } finally {
      setLoading(false);
    }
  }

  /** A new plan that needs other sessions moved: confirm the move, or keep the time and accept it is late. */
  function askToMakeRoomForDraft(plan: PlacementPlan, f: SessionForm) {
    const createLate = async () => {
      try {
        const created = await createSession({
          ...createInput(f, tz),
          infeasiblePolicy: "ACCEPT_LATE_DEADLINE",
        } as CreateSessionInput);
        newUploadsRef.current = [];
        finishCreate(created);
      } catch (error) {
        const again = getPlacementPlan(error);
        if (again) void askToMakeRoomForDraft(again, f);
        else errorToast(t("Couldn't create the session"));
      }
    };
    return openPlacementPlan({
      plan,
      subtitle: t("{title} needs a time. These sessions move to fit it.", { title: f.title }),
      title: f.title,
      durationMinutes: f.duration,
      onConfirmed: (res) => {
        notifyDisplaced(res);
        newUploadsRef.current = [];
        finishCreate(res.session);
      },
      onUndone: () => onChangedRef.current(),
      onLate: () => void createLate(),
    });
  }

  /** A plan is deleted. A lecture, exam or assignment is never deleted; it can be skipped. */
  function onDelete() {
    if (!session) return;
    if (session.type === "TASK") {
      deferDelete();
      return;
    }
    if (session.timetableGroupId) {
      setTimetableScopeOpen(true);
      return;
    }
    void runDelete(() => skipSession(session.id), t("Session skipped"));
  }

  /**
   * The block leaves the calendar at once. Nothing is sent until the undo
   * window closes, and Undo cancels the send and brings the block back.
   */
  function deferDelete() {
    if (!session) return;
    const target = session;
    const hide = hideSessions({ id: target.id });
    const cancel = deferCommit(async () => {
      try {
        await removeSession(target.id);
      } catch (error) {
        hide();
        errorToast(t("Couldn't delete session"), {
          description: apiErrorMessage(error, t("It's still on your calendar. Try again in a moment.")),
        });
      } finally {
        onChangedRef.current();
      }
    });
    toast(t("Session deleted"), {
      icon: "trash",
      duration: UNDO_WINDOW_MS,
      action: {
        label: t("Undo"),
        onClick: () => {
          cancel();
          hide();
        },
      },
    });
    onClose();
  }

  async function chooseTimetableScope(scope: TimetableScope) {
    if (!session) return;
    setTimetableScopeOpen(false);
    const skip = {
      occurrence: () => skipSession(session.id),
      following: () => skipTimetableGroupFrom(session.id),
      all: () => skipTimetableGroup(session.id),
    }[scope];
    await runDelete(skip, t("Session skipped"));
  }

  async function runDelete(remove: () => Promise<unknown>, done: string) {
    setLoading(true);
    try {
      await remove();
      onChanged();
      toast.success(done, {
        icon: "calendar-check",
        description: t("The calendar is up to date."),
      });
      onClose();
    } catch (error) {
      errorToast(t("Couldn't delete the session"), {
        description: apiErrorMessage(error, t("It's still on your calendar. Try again in a moment.")),
      });
    } finally {
      setLoading(false);
    }
  }

  async function handleClose() {
    if (!session) {
      // A draft closed without submitting drops its unsaved uploads.
      const unused = newUploadsRef.current;
      newUploadsRef.current = [];
      if (unused.length > 0) await postData("/files/remove", { ids: unused }).catch(() => {});
    } else {
      const kept = extractFileIdsFromNoteContent(formRef.current.note);
      const dropped = newUploadsRef.current.filter((id) => !kept.includes(id));
      newUploadsRef.current = [];
      if (dropped.length > 0) await postData("/files/remove", { ids: dropped }).catch(() => {});
      await flush();
    }
    onClose();
  }

  const isDraft = !session;
  const isTask = form.type === "TASK";
  const tone = session ? sessionTone(deriveState(session), session.late) : SESSION_TYPE_TONE[form.type];
  const typeLabel = SESSION_TYPE_META[form.type]?.label;

  return (
    <>
      <Sheet open={open} onOpenChange={(o) => !o && void handleClose()}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "glass flex flex-col gap-0 p-0",
            isMobile
              ? "inset-0 h-dvh max-h-none w-full rounded-none border-0 p-0"
              : "w-full sm:max-w-2xl",
          )}
        >
          <SheetTitle className="sr-only">{isDraft ? t("New session") : form.title}</SheetTitle>

          <header className="flex shrink-0 items-center gap-3 py-5 ps-5 pe-14">
            <span
              aria-hidden="true"
              className={cn("size-3 shrink-0 rounded-full", SESSION_TONE_CLASSES[tone].dot)}
            />
            <div className="min-w-0 flex-1">
              <input
                value={form.title}
                onChange={(e) => update({ title: e.target.value }, ["title"])}
                onBlur={() => update({}, ["title"], true)}
                onKeyDown={(e) => e.key === "Enter" && update({}, ["title"], true)}
                placeholder={t("Name this session")}
                aria-label={t("Title")}
                disabled={loading}
                className="w-full bg-transparent text-xl font-semibold tracking-tight outline-none placeholder:text-muted-foreground/60"
              />
              {typeLabel && (
                <p className="text-xs text-muted-foreground">{t(typeLabel)}</p>
              )}
            </div>
            {saved && (
              <span
                role="status"
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary animate-in fade-in-0"
              >
                <Check className="size-3.5" />
                {t("Saved")}
              </span>
            )}
            {isDraft ? (
              <Button onClick={submitDraft} disabled={loading} className="shrink-0 rounded-full">
                <BusyOr busy={loading} className="size-4">
                  {t("Schedule it")}
                </BusyOr>
              </Button>
            ) : (
              <GlassIconButton
                icon={Trash2}
                label={t(isTask ? "Delete session" : "Skip session")}
                destructive
                onClick={onDelete}
                disabled={loading}
              />
            )}
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-8">
            {loaded ? (
              <SessionEditor
                session={session}
                form={form}
                tz={tz}
                tone={tone}
                disabled={loading}
                onChange={update}
                newUploadsRef={newUploadsRef}
                onCommitNote={() => void flush()}
              />
            ) : (
              <div className="flex justify-center py-12">
                <DelayedSpinner busy className="size-5 text-primary" />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <TimetableScopeSheet
        open={timetableScopeOpen}
        onOpenChange={setTimetableScopeOpen}
        onChoose={(scope) => void chooseTimetableScope(scope)}
      />


      {pendingPick && pendingPick.slotProposalId && pendingPick.alternativeSlot && (
        <SlotPickDialog
          open
          sessionId={pendingPick.id}
          slotProposalId={pendingPick.slotProposalId}
          primarySlot={pendingPick.primarySlot ?? pendingPick.scheduledStartTime ?? ""}
          alternativeSlot={pendingPick.alternativeSlot}
          title={pendingPick.title}
          tz={tz}
          onResolved={(s) => {
            setPendingPick(null);
            finishCreate(s);
          }}
          onDismiss={() => {
            const s = pendingPick;
            setPendingPick(null);
            finishCreate(s);
          }}
        />
      )}
    </>
  );
}
