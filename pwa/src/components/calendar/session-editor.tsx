import { SessionNoteField } from "@/components/calendar/session-note-field";
import {
  type SessionForm,
  type SessionType,
  SESSION_TYPES,
  fixedDuration,
  instantAtStart,
} from "@/components/calendar/session-form";
import { PlacePicker } from "@/components/places/place-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { TimePicker } from "@/components/ui/time-picker";
import { durationLabel } from "@/lib/duration-label";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { zonedNow } from "@/utils/tz";
import {
  SESSION_TONE_CLASSES,
  SESSION_TYPE_META,
  hhmmToMinutes,
  reminderLabel,
  type SessionTone,
} from "@zenflow/core";
import { MAX_REMINDERS_PER_SESSION, type Session } from "@zenflow/shared";
import { addDays, endOfMonth, endOfWeek, format, startOfDay } from "date-fns";
import { format as formatDisplay } from "@/lib/format";
import { Bell, CalendarClock, Clock, MapPin, Tag, Timer, type LucideIcon } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";

/** Which picker is open under a row. */
type Row = "deadline" | "length" | "scheduled" | "when" | "reminder" | "tags";

/** Plan lengths the slider stops at: 15 minutes up to 8 hours. */
const DURATION_STEPS = Array.from({ length: 32 }, (_, i) => (i + 1) * 15);
/** Reminder lead times the slider stops at. */
const REMINDER_STEPS = [5, 10, 15, 30, 60, 120, 240, 480, 1440, 2880, 10080];
/** Reminders one tap toggles; any other lead time comes from the slider. */
const QUICK_REMINDERS = [0, 15, 60, 1440];

/** `HH:mm` for minutes from midnight. */
const clock = (min: number) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/** A `yyyy-MM-dd` day as a label. An empty day has no label, so it never reaches the date formatter. */
const dayLabel = (day: string) =>
  day ? formatDisplay(new Date(`${day}T00:00:00`), "EEE d MMM") : "";

export interface SessionEditorProps {
  /** The saved session, or `null` for a draft. */
  session: Session | null;
  form: SessionForm;
  tz: string;
  tone: SessionTone;
  disabled: boolean;
  /**
   * Updates the form. `names` are the fields to save; `immediate` skips the
   * pause after typing. A draft has nothing to save, so `names` is ignored.
   */
  onChange: (patch: Partial<SessionForm>, names: (keyof SessionForm)[], immediate?: boolean) => void;
  newUploadsRef: RefObject<string[]>;
  onCommitNote: () => void;
}

/** A property line: a tinted tile, a label, the value, and the picker under it. */
function PropertyRow({
  icon: Icon,
  tone,
  label,
  value,
  open,
  onToggle,
  children,
}: {
  icon: LucideIcon;
  tone: SessionTone;
  label: string;
  value: string;
  open?: boolean;
  /** Without it the row is read-only. */
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const colors = SESSION_TONE_CLASSES[tone];
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={onToggle}
        disabled={!onToggle}
        aria-expanded={onToggle ? open : undefined}
        className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 py-1 text-left transition-colors enabled:hover:bg-muted/50 disabled:cursor-default"
      >
        <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", colors.tint, colors.text)}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium text-muted-foreground">{label}</span>
          <span className="block truncate text-[14px] font-medium">{value}</span>
        </span>
      </button>
      {open && children && (
        <div className="mx-2 mb-2 animate-in rounded-xl bg-muted/40 p-3 fade-in-0 slide-in-from-top-1">
          {children}
        </div>
      )}
    </div>
  );
}

/** A tap target sized for a thumb: 40px tall. */
function Chip({
  selected,
  onClick,
  disabled,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "min-h-10 rounded-full border px-3.5 text-[14px] font-medium transition-colors disabled:opacity-40",
        selected
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground enabled:hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/**
 * A slider over fixed steps. Dragging shows the value; releasing reports it.
 * The thumb sits on the nearest step to `value`.
 */
function StepSlider({
  steps,
  value,
  label,
  onCommit,
}: {
  steps: readonly number[];
  value: number;
  label: (minutes: number) => string;
  onCommit: (minutes: number) => void;
}) {
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const index = steps.reduce(
    (best, step, i) => (Math.abs(step - shown) < Math.abs(steps[best] - shown) ? i : best),
    0,
  );
  return (
    <div className="flex flex-col gap-2 px-1">
      <span className="text-[15px] font-semibold">{label(shown)}</span>
      <Slider
        min={0}
        max={steps.length - 1}
        step={1}
        value={[index]}
        onValueChange={([i]) => setDrag(steps[i])}
        onValueCommit={([i]) => {
          setDrag(null);
          onCommit(steps[i]);
        }}
        className="py-3"
      />
    </div>
  );
}

/** Quick reminder toggles, any other lead time already set, and a slider to add one more. */
function ReminderChoices({
  reminders,
  onChange,
}: {
  reminders: number[];
  onChange: (next: number[]) => void;
}) {
  const [pending, setPending] = useState(60);
  const full = reminders.length >= MAX_REMINDERS_PER_SESSION;
  const others = reminders.filter((m) => !(QUICK_REMINDERS as readonly number[]).includes(m));
  const toggle = (m: number) => {
    const next = reminders.includes(m)
      ? reminders.filter((x) => x !== m)
      : [...reminders, m].sort((a, b) => a - b);
    onChange(next);
  };
  const addable = !full && !reminders.includes(pending);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {QUICK_REMINDERS.map((m) => (
          <Chip
            key={m}
            selected={reminders.includes(m)}
            disabled={!reminders.includes(m) && full}
            onClick={() => toggle(m)}
          >
            {t(reminderLabel(m))}
          </Chip>
        ))}
        {others.map((m) => (
          <Chip key={m} selected onClick={() => toggle(m)}>
            {t(reminderLabel(m))}
          </Chip>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <StepSlider
            steps={REMINDER_STEPS}
            value={pending}
            label={(m) => t(reminderLabel(m))}
            onCommit={setPending}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!addable}
          onClick={() => onChange([...reminders, pending].sort((a, b) => a - b))}
        >
          {t("Add")}
        </Button>
      </div>
    </div>
  );
}

/**
 * A session as a view you edit in place: type chips for a draft, one line per
 * property with its picker opening under it, then the notes. Nothing here is
 * a form: every change lands in the sheet's state, which saves it.
 */
export function SessionEditor({
  session,
  form,
  tz,
  tone,
  disabled,
  onChange,
  newUploadsRef,
  onCommitNote,
}: SessionEditorProps) {
  const [open, setOpen] = useState<Row | null>(null);
  const toggle = (row: Row) => setOpen((cur) => (cur === row ? null : row));
  const [planning, setPlanning] = useState(false);
  const [pickingDay, setPickingDay] = useState(false);
  const isDraft = !session;
  const isTask = form.type === "TASK";
  const today = zonedNow(tz);
  const deadlineOptions: [string, string][] = [
    [t("Today"), format(today, "yyyy-MM-dd")],
    [t("Tomorrow"), format(addDays(today, 1), "yyyy-MM-dd")],
    [t("This week"), format(endOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd")],
    [t("Next week"), format(endOfWeek(addDays(today, 7), { weekStartsOn: 1 }), "yyyy-MM-dd")],
    [t("This month"), format(endOfMonth(today), "yyyy-MM-dd")],
  ];
  const startMin = hhmmToMinutes(form.startTime || "09:00");
  const endMin = hhmmToMinutes(form.endTime || "10:00");
  const isCustomDeadline =
    !!form.deadline && !deadlineOptions.some(([, day]) => day === form.deadline);
  const showDeadlineCalendar = pickingDay || isCustomDeadline;

  const deadlineChoices = (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {deadlineOptions.map(([label, day]) => (
          <Chip
            key={label}
            selected={form.deadline === day}
            onClick={() => {
              setPickingDay(false);
              onChange({ deadline: day }, ["deadline"], true);
            }}
          >
            {label}
          </Chip>
        ))}
        <Chip selected={showDeadlineCalendar} onClick={() => setPickingDay((v) => !v)}>
          {t("Pick a day")}
        </Chip>
      </div>
      {showDeadlineCalendar && (
        <div className="w-full overflow-hidden">
          <Calendar
            mode="single"
            className="w-full bg-transparent p-0"
            selected={form.deadline ? new Date(`${form.deadline}T00:00:00`) : undefined}
            disabled={{ before: startOfDay(zonedNow(tz)) }}
            onSelect={(d) => d && onChange({ deadline: format(d, "yyyy-MM-dd") }, ["deadline"], true)}
          />
        </div>
      )}
    </div>
  );

  const durationSlider = (
    <StepSlider
      steps={DURATION_STEPS}
      value={form.duration}
      label={durationLabel}
      onCommit={(duration) => onChange({ duration }, ["duration"], true)}
    />
  );

  const reminderChoices = (
    <ReminderChoices
      reminders={form.reminders}
      onChange={(reminders) => onChange({ reminders }, ["reminders"], true)}
    />
  );

  const location = (
    <PropertyRow
      icon={MapPin}
      tone={tone}
      label={t("Location")}
      value={form.place.text.trim() || t("No location")}
      onToggle={disabled ? undefined : () => setPlanning(true)}
    />
  );

  const tags = (
    <PropertyRow
      icon={Tag}
      tone={tone}
      label={t("Tags")}
      value={form.tags.trim() || t("No tags")}
      open={open === "tags"}
      onToggle={disabled ? undefined : () => toggle("tags")}
    >
      <Input
        value={form.tags}
        onChange={(e) => onChange({ tags: e.target.value }, ["tags"])}
        onBlur={() => onChange({}, ["tags"], true)}
        placeholder={t("Comma separated")}
        autoFocus
      />
    </PropertyRow>
  );

  return (
    <div className="flex flex-col gap-4">
      {isDraft && (
        <div className="flex flex-wrap gap-1.5">
          {SESSION_TYPES.map((type: SessionType) => (
            <Chip
              key={type}
              selected={form.type === type}
              onClick={() => onChange({ type }, [])}
            >
              {t(SESSION_TYPE_META[type].label)}
            </Chip>
          ))}
        </div>
      )}

      {isDraft && isTask && (
        <div className="flex flex-col gap-0.5">
          <PropertyRow
            icon={CalendarClock}
            tone={tone}
            label={t("Deadline")}
            value={form.deadline ? dayLabel(form.deadline) : t("No deadline")}
            open={open === "deadline"}
            onToggle={disabled ? undefined : () => toggle("deadline")}
          >
            {deadlineChoices}
          </PropertyRow>
          <PropertyRow
            icon={Timer}
            tone={tone}
            label={t("Length")}
            value={durationLabel(form.duration)}
            open={open === "length"}
            onToggle={disabled ? undefined : () => toggle("length")}
          >
            {durationSlider}
          </PropertyRow>
          <PropertyRow
            icon={Bell}
            tone={tone}
            label={t("Reminder")}
            value={
              form.reminders.length > 0
                ? form.reminders.map((m) => t(reminderLabel(m))).join(", ")
                : t("No reminder")
            }
            open={open === "reminder"}
            onToggle={disabled ? undefined : () => toggle("reminder")}
          >
            {reminderChoices}
          </PropertyRow>
          {location}
          {tags}
        </div>
      )}

      {!isDraft && isTask && (
        <div className="flex flex-col gap-0.5">
          <PropertyRow
            icon={CalendarClock}
            tone={tone}
            label={t("Deadline")}
            value={form.deadline ? dayLabel(form.deadline) : t("No deadline")}
            open={open === "deadline"}
            onToggle={disabled ? undefined : () => toggle("deadline")}
          >
            {deadlineChoices}
          </PropertyRow>
          <PropertyRow
            icon={Clock}
            tone={tone}
            label={t("Scheduled")}
            value={
              form.date
                ? `${dayLabel(form.date)}, ${clock(startMin)}–${clock(startMin + form.duration)}`
                : t("Pick a day")
            }
            open={open === "scheduled"}
            onToggle={disabled ? undefined : () => toggle("scheduled")}
          >
            <div className="flex flex-col gap-3">
              <div className="w-full overflow-hidden">
                <Calendar
                  mode="single"
                  className="w-full bg-transparent p-0"
                  selected={form.date ? new Date(`${form.date}T00:00:00`) : undefined}
                  onSelect={(d) => d && onChange({ date: format(d, "yyyy-MM-dd") }, ["date"], true)}
                />
              </div>
              <TimePicker
                value={startMin}
                onChange={(m) =>
                  onChange({ startTime: clock(m), endTime: clock(m + form.duration) }, ["startTime"], true)
                }
              />
              {durationSlider}
            </div>
          </PropertyRow>
          <PropertyRow
            icon={Bell}
            tone={tone}
            label={t("Reminder")}
            value={
              form.reminders.length > 0
                ? form.reminders.map((m) => t(reminderLabel(m))).join(", ")
                : t("No reminder")
            }
            open={open === "reminder"}
            onToggle={disabled ? undefined : () => toggle("reminder")}
          >
            {reminderChoices}
          </PropertyRow>
          {location}
          {tags}
        </div>
      )}

      {!isTask && (
        <div className="flex flex-col gap-0.5">
          <PropertyRow
            icon={Clock}
            tone={tone}
            label={t("When")}
            value={form.date ? `${dayLabel(form.date)}, ${clock(startMin)}–${clock(endMin)}` : t("Pick a day")}
            open={open === "when"}
            onToggle={isDraft && !disabled ? () => toggle("when") : undefined}
          >
            <div className="flex flex-col gap-3">
              <div className="w-full overflow-hidden">
                <Calendar
                  mode="single"
                  className="w-full bg-transparent p-0"
                  selected={form.date ? new Date(`${form.date}T00:00:00`) : undefined}
                  onSelect={(d) =>
                    d && onChange({ date: format(d, "yyyy-MM-dd") }, ["date", "startTime", "endTime"], true)
                  }
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TimePicker
                  value={startMin}
                  onChange={(m) => {
                    const length = fixedDuration(form.startTime, form.endTime);
                    onChange(
                      { startTime: clock(m), endTime: clock(m + length) },
                      ["date", "startTime", "endTime"],
                      true,
                    );
                  }}
                />
                <TimePicker
                  value={endMin}
                  onChange={(m) => onChange({ endTime: clock(m) }, ["endTime"], true)}
                />
              </div>
            </div>
          </PropertyRow>
          {form.type !== "DND" && (
            <PropertyRow
              icon={Bell}
              tone={tone}
              label={t("Reminder")}
              value={
                form.reminders.length > 0
                  ? form.reminders.map((m) => t(reminderLabel(m))).join(", ")
                  : t("No reminder")
              }
              open={open === "reminder"}
              onToggle={disabled ? undefined : () => toggle("reminder")}
            >
              {reminderChoices}
            </PropertyRow>
          )}
          {location}
          {tags}
        </div>
      )}

      <PlacePicker
        value={form.place}
        open={planning}
        onOpenChange={setPlanning}
        onChange={(place) => onChange({ place }, ["place"], true)}
        at={form.date ? instantAtStart(form.date, form.startTime, tz) : null}
      />

      <section className="px-2">
        <SessionNoteField
          key={session?.id ?? "draft"}
          initial={form.note}
          value={form.note}
          onChange={(note) => onChange({ note }, ["note"])}
          onCommit={onCommitNote}
          newUploadsRef={newUploadsRef}
          disabled={disabled}
        />
      </section>
    </div>
  );
}
