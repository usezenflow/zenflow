import { isSyncedSession } from "@/lib/synced-session";
import {
  Bell,
  CalendarClock,
  ChevronRight,
  Clock,
  MapPin,
  Maximize2,
  Notebook,
  Repeat,
  Tag,
  type LucideIcon,
} from "@/components/Icons";
import { ErrorBoundary } from "@/components/error-boundary";
import { DeadlinePicker, deadlineLine } from "@/components/tasks/fields/deadline-picker";
import { DurationPicker } from "@/components/tasks/fields/duration-picker";
import { EventWhenPicker, type EventWhen } from "@/components/tasks/fields/event-when-picker";
import { ReminderField } from "@/components/tasks/fields/reminder-field";
import { localizedReminderLabel } from "@/components/tasks/fields/reminder-field";
import { DescriptionField } from "@/components/tasks/note/description-field";
import { SessionNote } from "@/components/tasks/note/session-note";
import { LocationScreen, type LocationValue } from "@/components/calendar/location-screen";
import { BottomSheetTextInput } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import { TimelineTimePicker } from "@/components/ui/timeline-time-picker";
import { WeekStripDatePicker } from "@/components/ui/week-strip-date-picker";
import { durationLabel } from "@/components/ui/duration-slider";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/use-language";
import { useOffline } from "@/hooks/use-offline";
import { useUserStore } from "@/hooks/use-user-store";
import { DURATION, useReducedMotion } from "@/lib/motion";
import { format, t } from "@/lib/i18n";
import { isNoteEmpty } from "@/lib/note-html";
import { isPastDeadlineDrop } from "@/lib/overdue";
import { clockLabel } from "@/lib/slider-math";
import { draftValues, patchFor, saveSession, valuesFromSession } from "@/lib/session-save";
import { useColorScheme } from "@/lib/useColorScheme";
import {
  SESSION_TONES,
  SESSION_TYPE_TONE,
  type SessionFormValues,
  displayLocation,
  hhmmToMinutes,
  zonedDate,
} from "@zenflow/core";
import { DEFAULT_REMINDER_MINUTES, type Session, type UpdateSessionInput } from "@zenflow/shared";
import * as Haptics from "expo-haptics";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

/** Typing and picks save once the user pauses for this long. */
const SAVE_DEBOUNCE_MS = 600;
/** How long the "Saved" pill stays after a save lands. */
const SAVED_PILL_MS = 1500;

const WEEKDAYS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

/** The weekly repeat of a fixed session, e.g. `Mon, Wed`. */
function repeatLabel(rrule: string | null): string | null {
  if (!rrule) return null;
  const byday = /BYDAY=([A-Z,]+)/.exec(rrule)?.[1]?.split(",") ?? [];
  if (/FREQ=DAILY/.test(rrule)) return t("Every day");
  if (byday.length === 0) return /FREQ=WEEKLY/.test(rrule) ? t("Every week") : null;
  return byday.map((d) => t(WEEKDAYS[d] ?? d)).join(", ");
}

/** Which inline picker is open under a row. */
type Open = "when" | "placed" | "deadline" | "duration" | "reminder" | null;

/** The session's colours: the tile fill, and the ink its icons and labels use. */
interface Tint {
  fill: string;
  ink: string;
}

/** A 32 px rounded tile with the icon, tinted in the session's colour. */
function Tile({ icon: Icon, tint }: { icon: LucideIcon; tint: Tint }) {
  return (
    <View
      className="h-7 w-7 items-center justify-center rounded-lg"
      style={{ backgroundColor: tint.fill }}
    >
      <Icon size={15} color={tint.ink} />
    </View>
  );
}

/**
 * One line of the session: a tinted tile, the value, and a chevron when it
 * opens a picker. The picker renders in a soft panel under the line.
 */
function PropertyRow({
  icon,
  tint,
  label,
  value,
  detail,
  testID,
  onPress,
  disabled,
  children,
}: {
  icon: LucideIcon;
  tint: Tint;
  label: string;
  value: string;
  /** A muted second line under the value. */
  detail?: string;
  testID: string;
  onPress?: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <View className="gap-1.5">
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={!onPress || disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        className="min-h-[40px] flex-row items-center gap-3 px-5 active:opacity-70"
      >
        <Tile icon={icon} tint={tint} />
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] leading-[20px]" numberOfLines={1}>
            {value}
          </Text>
          {detail ? (
            <Text className="text-[13px] leading-[18px] text-muted-foreground" numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        {onPress && <ChevronRight size={18} className="text-muted-foreground" />}
      </Pressable>
      {children && (
        <Animated.View
          entering={reduceMotion ? FadeIn : FadeInDown.duration(DURATION.base)}
          className="mx-5 rounded-2xl bg-muted/40 p-3"
        >
          {children}
        </Animated.View>
      )}
    </View>
  );
}

export interface SessionEditorProps {
  /** Told when a save lands (`true`) and when its confirmation should clear (`false`). */
  onSavedChange?: (saved: boolean) => void;
  /** The saved session, or `null` for a draft that is not placed yet. */
  session: Session | null;
  /** Starting values for a draft. */
  draft?: { title: string; deadline: string };
  tz: string;
  /** Saved rows go up here. The sheet keeps its own copy in step. */
  onSaved: (updated: Session) => void;
  /** Places a draft with its values. */
  onPlace?: (values: SessionFormValues) => Promise<void>;
}

/**
 * A session as a view you edit in place. The title and location are text you
 * type into, and they save while you type. Each time, deadline, length or
 * reminder opens its picker under its own line. A draft keeps its values until
 * its schedule button places it.
 */
export function SessionEditor({ session, draft, tz, onSaved, onSavedChange, onPlace }: SessionEditorProps) {
  useLanguage();
  const { toast, confirm } = useToast();
  const offline = useOffline();
  const user = useUserStore((s) => s.user);
  const { isDarkColorScheme } = useColorScheme();
  const disabled = offline;
  const locked = isSyncedSession(session);
  const isTask = !session || session.type === "TASK";
  const tone = SESSION_TONES[SESSION_TYPE_TONE[session?.type ?? "TASK"]];
  const tint: Tint = {
    fill: `${tone.base}2E`,
    ink: isDarkColorScheme ? tone.ink.dark : tone.ink.light,
  };
  const [values, setValues] = useState<SessionFormValues>(() =>
    session
      ? valuesFromSession(session, tz)
      : draftValues(draft ?? { title: "", deadline: "" }, user?.defaultReminderMinutes ?? DEFAULT_REMINDER_MINUTES),
  );
  const [open, setOpen] = useState<Open>(null);
  const [placing, setPlacing] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);

  // The timers and cleanup run later, so they read the latest state through refs.
  const latest = useRef(session);
  latest.current = session;
  const valuesRef = useRef(values);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onSavedChangeRef = useRef(onSavedChange);
  onSavedChangeRef.current = onSavedChange;
  const openNote = useRef<(() => void) | null>(null);
  const originRef = useRef(session?.originLocation ?? "");
  const originPointRef = useRef<{ lat: number; lng: number } | null>(
    session?.originLat != null && session?.originLng != null
      ? { lat: session.originLat, lng: session.originLng }
      : null,
  );

  const commuteRef = useRef<number | null>(session?.commuteMinutes ?? null);
  // Re-renders the Location row when the start or travel time changes.
  const [, setTripTick] = useState(0);

  const dirty = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef(() => {});
  flush.current = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current.size === 0) return;
    const names = new Set(dirty.current);
    dirty.current.clear();
    const current = latest.current;
    if (!current) return;
    const v = valuesRef.current;
    const patch: UpdateSessionInput = patchFor(names, v, current, tz);
    if (names.has("title")) {
      const title = v.title.trim();
      if (title && title !== current.title) patch.title = title;
    }
    if (names.has("location")) {
      const location = v.location?.trim() || null;
      if ((current.location ?? null) !== location) patch.location = location;
      const origin = originRef.current.trim() || null;
      const originLat = origin ? originPointRef.current?.lat ?? null : null;
      const originLng = origin ? originPointRef.current?.lng ?? null : null;
      if (
        (current.originLocation ?? null) !== origin ||
        (current.originLat ?? null) !== originLat ||
        (current.originLng ?? null) !== originLng
      ) {
        patch.originLocation = origin;
        patch.originLat = originLat;
        patch.originLng = originLng;
      }
      const commute = origin && location ? commuteRef.current : null;
      if ((current.commuteMinutes ?? null) !== commute) patch.commuteMinutes = commute;
      const lat = location ? (v.locationLat ?? null) : null;
      const lng = location ? (v.locationLng ?? null) : null;
      if ((current.locationLat ?? null) !== lat || (current.locationLng ?? null) !== lng) {
        patch.locationLat = lat;
        patch.locationLng = lng;
      }
    }
    if (Object.keys(patch).length === 0) return;
    // A plan moved past its own due time is almost always a slip.
    if (
      current.type === "TASK" &&
      patch.scheduledStartTime &&
      isPastDeadlineDrop(patch.scheduledStartTime, current.deadline)
    ) {
      confirm(t("Past the deadline?"), {
        description: t("This session will start past its due time."),
        confirmLabel: t("Keep late"),
        cancelLabel: t("Snap back"),
        onConfirm: () => void save(current, patch),
        onCancel: () => {
          const back = valuesFromSession(current, tz);
          valuesRef.current = { ...valuesRef.current, date: back.date, startTime: back.startTime };
          setValues(valuesRef.current);
        },
      });
      return;
    }
    void save(current, patch);
  };

  useEffect(
    () => () => {
      flush.current();
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  /**
   * Updates the view now and saves the named fields once the user pauses.
   * `immediate` skips the pause (blur, submit, a finished pick).
   */
  function set(patch: Partial<SessionFormValues>, names: string[], immediate = false) {
    const next = { ...valuesRef.current, ...patch };
    valuesRef.current = next;
    setValues(next);
    if (!latest.current || names.length === 0) return;
    for (const n of names) dirty.current.add(n);
    if (timer.current) clearTimeout(timer.current);
    if (immediate) flush.current();
    else timer.current = setTimeout(() => flush.current(), SAVE_DEBOUNCE_MS);
  }

  function save(current: Session, patch: UpdateSessionInput) {
    return saveSession({
      toast,
      tz,
      session: current,
      patch,
      onSaved: (updated) => {
        latest.current = updated;
        onSavedRef.current(updated);
        onSavedChangeRef.current?.(true);
        void Haptics.selectionAsync().catch(() => {});
        if (savedTimer.current) clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => onSavedChangeRef.current?.(false), SAVED_PILL_MS);
      },
    }).catch(() => {});
  }

  function commitNote(html: string) {
    const current = latest.current;
    if (!current) return;
    const note = html || null;
    if ((current.note || null) === note) return;
    void save(current, { note });
  }

  async function place() {
    if (!onPlace) return;
    setPlacing(true);
    try {
      await onPlace({
        ...valuesRef.current,
        originLocation: originRef.current.trim() || null,
        originLat: originPointRef.current?.lat ?? null,
        originLng: originPointRef.current?.lng ?? null,
        commuteMinutes: commuteRef.current,
      });
    } finally {
      setPlacing(false);
    }
  }

  const note = session?.note ?? "";
  const repeat = session ? repeatLabel(session.rrule) : null;
  const toggle = (row: Exclude<Open, null>) => {
    void Haptics.selectionAsync().catch(() => {});
    setOpen((cur) => (cur === row ? null : row));
  };
  const startMin = hhmmToMinutes(values.startTime || "09:00");
  const endMin = hhmmToMinutes(values.endTime || "10:00");
  const lengthMin = Math.max(15, endMin - startMin);
  const when: EventWhen = {
    date: values.date || format(new Date(), "yyyy-MM-dd"),
    startMin,
    lengthMin,
  };
  const whenLine = session?.scheduledStartTime
    ? format(zonedDate(session.scheduledStartTime, tz), "EEE d MMM")
    : "";

  const tripOrigin = originRef.current.trim();
  const tripPlace = values.location?.trim() ?? "";
  const tripLine =
    tripOrigin && tripPlace
      ? t("{from} to {to}", { from: displayLocation(tripOrigin), to: displayLocation(tripPlace) })
      : null;
  const tripDetail =
    tripLine && commuteRef.current != null ? t("{minutes} min", { minutes: String(commuteRef.current) }) : undefined;

  return (
    <View className="gap-3 pb-4 pt-1" testID="session.editor">
      <View className="px-5">
        <BottomSheetTextInput
          testID="session.title"
          editable={!disabled && !placing && !locked}
          value={values.title}
          onChangeText={(title) => set({ title }, ["title"])}
          onBlur={() => set({}, ["title"], true)}
          onSubmitEditing={() => set({}, ["title"], true)}
          returnKeyType="done"
          placeholder={t("Untitled")}
          accessibilityLabel={t("Title")}
          multiline={false}
          className="border-0 bg-transparent px-0 py-1 text-[18px] font-bold tracking-tight text-foreground"
        />
        {values.title === "" && !session && (
          <Text className="text-[12px] text-destructive">{t("Name your plan")}</Text>
        )}
      </View>

      <View className="gap-0.5">
        {isTask ? (
          <PropertyRow
            testID="session.deadline"
            label={t("Deadline")}
            icon={CalendarClock}
            tint={tint}
            value={deadlineLine(values.deadline ?? "", tz, t("No deadline"))}
            onPress={() => toggle("deadline")}
            disabled={disabled || placing}
          >
            {open === "deadline" && (
              <DeadlinePicker
                value={values.deadline ?? ""}
                tz={tz}
                disabled={disabled || placing}
                defaultToNoRush={!session}
                onChange={(deadline) => set({ deadline }, ["deadline"])}
              />
            )}
          </PropertyRow>
        ) : (
          <PropertyRow
            testID="session.when"
            label={t("When")}
            icon={Clock}
            tint={tint}
            value={`${format(new Date(`${when.date}T00:00:00`), "EEE d MMM")}, ${clockLabel(startMin)}–${clockLabel(endMin)}`}
            onPress={locked ? undefined : () => toggle("when")}
            disabled={disabled}
          >
            {open === "when" && (
              <EventWhenPicker
                value={when}
                disabled={disabled}
                onChange={(next) =>
                  set(
                    {
                      date: next.date,
                      startTime: clockLabel(next.startMin),
                      endTime: clockLabel(next.startMin + next.lengthMin),
                    },
                    ["date", "startTime", "endTime"],
                  )
                }
              />
            )}
          </PropertyRow>
        )}

        {isTask && !session && (
          <PropertyRow
            testID="session.duration"
            label={t("Duration")}
            icon={Clock}
            tint={tint}
            value={durationLabel(values.duration ?? 60)}
            onPress={() => toggle("duration")}
            disabled={disabled || placing}
          >
            {open === "duration" && (
              <DurationPicker
                value={values.duration ?? 60}
                disabled={disabled || placing}
                onChange={(duration) => set({ duration }, ["duration"])}
              />
            )}
          </PropertyRow>
        )}

        {isTask && session && whenLine !== "" && (
          <PropertyRow
            testID="session.placed"
            label={t("Scheduled")}
            icon={Clock}
            tint={tint}
            value={whenLine}
            onPress={() => toggle("placed")}
            disabled={disabled}
          >
            {open === "placed" && (
              <View className="gap-4">
                <WeekStripDatePicker
                  testID="session.placed.date"
                  value={when.date}
                  disabled={disabled}
                  onChange={(date) => set({ date }, ["date", "startTime"])}
                />
                <TimelineTimePicker
                  testID="session.placed.start"
                  label="Start time"
                  value={startMin}
                  max={24 * 60 - (values.duration ?? 60)}
                  disabled={disabled}
                  onChange={(m) => set({ startTime: clockLabel(m) }, ["date", "startTime"])}
                />
              </View>
            )}
          </PropertyRow>
        )}

        {session?.type !== "DND" && (
          <PropertyRow
            testID="session.reminder"
            label={t("Reminder")}
            icon={Bell}
            tint={tint}
            value={
              values.reminders && values.reminders.length > 0
                ? values.reminders.map((m) => localizedReminderLabel(m)).join(", ")
                : t("No reminder")
            }
            onPress={() => toggle("reminder")}
            disabled={disabled || placing}
          >
            {open === "reminder" && (
              <ReminderField
                value={values.reminders ?? []}
                disabled={disabled || placing}
                onChange={(reminders) => set({ reminders }, ["reminders"], true)}
              />
            )}
          </PropertyRow>
        )}

        {repeat && <PropertyRow testID="session.repeat" label={t("Repeat")} icon={Repeat} tint={tint} value={repeat} />}

        <PropertyRow
          testID="session.location"
          label={t("Location")}
          icon={MapPin}
          tint={tint}
          value={tripLine ?? (values.location?.trim() ? displayLocation(values.location.trim()) : t("Add location"))}
          detail={tripDetail}
          onPress={() => setLocationOpen(true)}
          disabled={disabled}
        />

        {session && session.tags.length > 0 && (
          <PropertyRow testID="session.tags" label={t("Tags")} icon={Tag} tint={tint} value={session.tags.join(", ")} />
        )}
      </View>

      <View className="gap-2 px-5">
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-3">
            <Tile icon={Notebook} tint={tint} />
            <Text className="text-[15px] font-semibold">{t("Notes")}</Text>
          </View>
          <Pressable
            testID="session.note.expand"
            onPress={() => openNote.current?.()}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={t("Open notes full screen")}
            hitSlop={8}
            className="h-9 w-9 items-center justify-center rounded-full active:bg-muted/60"
          >
            <Maximize2 size={18} className="text-foreground" />
          </Pressable>
        </View>
        <ErrorBoundary fallbackMessage={t("The editor didn't load. Everything else still works.")}>
          {note && !isNoteEmpty(note) ? (
            <SessionNote key={note} html={note} />
          ) : (
            <Pressable
              testID="session.note.empty"
              onPress={() => openNote.current?.()}
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={t("Add notes…")}
              className="min-h-[36px] justify-center active:opacity-70"
            >
              <Text className="text-[15px] text-muted-foreground">{t("Add notes…")}</Text>
            </Pressable>
          )}
          <DescriptionField
            hideCard
            initialValue={session?.note ?? ""}
            onChange={() => {}}
            onDone={commitNote}
            disabled={disabled}
            openRef={openNote}
          />
        </ErrorBoundary>
      </View>

      {locationOpen && (
        <LocationScreen
          destinationLocked={locked}
          initial={{
            text: values.location ?? "",
            point:
              values.locationLat != null && values.locationLng != null
                ? { lat: values.locationLat, lng: values.locationLng }
                : null,
            origin: originRef.current,
            originPoint: originPointRef.current,
            commuteMinutes: commuteRef.current,
          }}
          onClose={(next: LocationValue) => {
            setLocationOpen(false);
            originRef.current = next.origin;
            originPointRef.current = next.originPoint;
            commuteRef.current = next.commuteMinutes;
            setTripTick((n) => n + 1);
            // A synced session's place belongs to the sync; only the start changes.
            set(
              locked
                ? {}
                : { location: next.text, locationLat: next.point?.lat ?? null, locationLng: next.point?.lng ?? null },
              ["location"],
              true,
            );
          }}
        />
      )}

      {!session && onPlace && (
        <View className="px-5">
          <Button
            testID="session.place"
            className="h-12 w-full rounded-full"
            loading={placing}
            disabled={disabled}
            onPress={() => void place()}
          >
            <Text className="text-[15px] font-semibold text-primary-foreground">{t("Schedule it")}</Text>
          </Button>
        </View>
      )}
    </View>
  );
}
