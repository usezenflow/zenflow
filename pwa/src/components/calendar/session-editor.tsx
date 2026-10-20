import { SessionNoteField } from "@/components/calendar/session-note-field";
import {
  type SessionForm,
  type SessionType,
  SESSION_TYPES,
  fixedDuration,
  instantAtStart,
} from "@/components/calendar/session-form";
import { PlacePicker } from "@/components/places/place-picker";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { TimePicker } from "@/components/ui/time-picker";
import { durationLabel } from "@/lib/duration-label";
import { dateFnsLocale, t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { zonedDate, zonedNow } from "@/utils/tz";
import {
  REMINDER_PRESETS,
  SESSION_TONE_CLASSES,
  SESSION_TYPE_META,
  hhmmToMinutes,
  reminderLabel,
  type SessionTone,
} from "@zenflow/core";
import { MAX_REMINDERS_PER_SESSION, type Session } from "@zenflow/shared";
import { addDays, endOfMonth, endOfWeek, format } from "date-fns";
import { format as formatDisplay } from "@/lib/format";
import { Bell, CalendarClock, Clock, MapPin, Tag, type LucideIcon } from "lucide-react";
import { type ReactNode, type RefObject, useState } from "react";

/** Which picker is open under a row. */
type Row = "deadline" | "duration" | "when" | "reminder" | "tags";

const DURATIONS = Array.from({ length: 16 }, (_, i) => (i + 1) * 15);

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
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl px-2 py-1.5 text-left transition-colors enabled:hover:bg-muted/50 disabled:cursor-default"
      >
        <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", colors.tint, colors.text)}>
          <Icon className="size-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-muted-foreground">{label}</span>
          <span className="block truncate text-[15px] font-medium">{value}</span>
        </span>
      </button>
      {open && children && (
        <div className="mx-2 mb-2 animate-in rounded-2xl bg-muted/40 p-3 fade-in-0 slide-in-from-top-1">
          {children}
        </div>
      )}
    </div>
  );
}

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
        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors disabled:opacity-40",
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

      <div className="flex flex-col gap-0.5">
        {isTask ? (
          <PropertyRow
            icon={CalendarClock}
            tone={tone}
            label={t("Deadline")}
            value={form.deadline ? dayLabel(form.deadline) : t("No deadline")}
            open={open === "deadline"}
            onToggle={disabled ? undefined : () => toggle("deadline")}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {deadlineOptions.map(([label, day]) => (
                  <Chip
                    key={label}
                    selected={form.deadline === day}
                    onClick={() => onChange({ deadline: day }, ["deadline"], true)}
                  >
                    {label}
                  </Chip>
                ))}
              </div>
              <div className="w-full overflow-hidden">
                <Calendar
                  mode="single"
                  className="w-full bg-transparent p-0"
                  selected={form.deadline ? new Date(`${form.deadline}T00:00:00`) : undefined}
                  onSelect={(d) => d && onChange({ deadline: format(d, "yyyy-MM-dd") }, ["deadline"], true)}
                />
              </div>
            </div>
          </PropertyRow>
        ) : (
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
        )}

        {isTask && (
          <PropertyRow
            icon={Clock}
            tone={tone}
            label={t("Length")}
            value={durationLabel(form.duration)}
            open={open === "duration"}
            onToggle={disabled ? undefined : () => toggle("duration")}
          >
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((m) => (
                <Chip
                  key={m}
                  selected={form.duration === m}
                  onClick={() => onChange({ duration: m }, ["duration"], true)}
                >
                  {durationLabel(m)}
                </Chip>
              ))}
            </div>
          </PropertyRow>
        )}

        {session?.scheduledStartTime && isTask && (
          <PropertyRow
            icon={Clock}
            tone={tone}
            label={t("Scheduled")}
            value={formatDisplay(zonedDate(session.scheduledStartTime, tz), "EEE d MMM, HH:mm", {
              locale: dateFnsLocale(),
            })}
          />
        )}

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
            <div className="grid grid-cols-3 gap-1.5">
              {REMINDER_PRESETS.map((m) => {
                const selected = form.reminders.includes(m);
                return (
                  <Chip
                    key={m}
                    selected={selected}
                    disabled={!selected && form.reminders.length >= MAX_REMINDERS_PER_SESSION}
                    onClick={() => {
                      const next = selected
                        ? form.reminders.filter((x) => x !== m)
                        : [...form.reminders, m].sort((a, b) => a - b);
                      onChange({ reminders: next }, ["reminders"], true);
                    }}
                  >
                    {t(reminderLabel(m))}
                  </Chip>
                );
              })}
            </div>
          </PropertyRow>
        )}

        <PropertyRow
          icon={MapPin}
          tone={tone}
          label={t("Location")}
          value={form.place.text.trim() || t("No location")}
          onToggle={disabled ? undefined : () => setPlanning(true)}
        />
        <PlacePicker
          value={form.place}
          open={planning}
          onOpenChange={setPlanning}
          onChange={(place) => onChange({ place }, ["place"], true)}
          at={form.date ? instantAtStart(form.date, form.startTime, tz) : null}
        />

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
      </div>

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
