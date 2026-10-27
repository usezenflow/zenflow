import { Text } from "@/components/ui/text";
import { t } from "@/lib/i18n";
import {
  RANGE_IDS,
  rangePreset,
  type Range,
  type RangeId,
} from "@/lib/palette/command";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import type {
  Session,
  SessionWindow,
  UpdateSessionInput,
} from "@zenflow/shared";
import { addDays, format, startOfDay } from "date-fns";
import { useState } from "react";
import { Pressable } from "react-native";
import { Ico, type IconName } from "./icons";
import { PanelRow, ResultPanel } from "./result-panel";
import { DurationSheet } from "./duration-sheet";
import { WhenSheet } from "./when-sheet";

const RANGE_LABEL: Record<RangeId, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  this_week: "This week",
  next_week: "Next week",
  last_week: "Last week",
  next_7: "Next 7 days",
  past_7: "Past 7 days",
  this_month: "This month",
  last_month: "Last month",
};

const span = (r: Range) =>
  r.from.toDateString() === r.to.toDateString()
    ? format(r.from, "EEE d/M")
    : `${format(r.from, "d/M")} ${t("to")} ${format(r.to, "d/M")}`;

/** Quick actions then Custom (start date, end date). */
export function RangeMenu({
  now,
  onPick,
  icon = "calendar",
  allowPast = false,
}: {
  now: Date;
  onPick: (r: Range) => void;
  icon?: IconName;
  allowPast?: boolean;
}) {
  const [step, setStep] = useState<null | { from?: Date }>(null);
  const today = startOfDay(now);
  const floor = allowPast ? new Date(2020, 0, 1) : today;
  // Only a recap looks back; every other range starts today.
  const presets = RANGE_IDS.map((id) => {
    const r = rangePreset(id, now);
    return { id, r: allowPast || r.from >= today ? r : { ...r, from: today } };
  }).filter(({ r }) => allowPast || r.to >= today);
  return (
    <ResultPanel testID="range-menu" title={t("Range")}>
      {presets.map(({ id, r }) => (
        <PanelRow
          key={id}
          testID={`range-${id}`}
          icon={icon}
          title={t(RANGE_LABEL[id])}
          sub={span(r)}
          selected={id === "this_week"}
          onPress={() => onPick(r)}
        />
      ))}
      <PanelRow
        testID="range-custom"
        icon="sliders"
        title={t("Custom")}
        onPress={() => setStep({})}
      />
      {step && (
        <WhenSheet
          key={step.from ? "to" : "from"}
          title={step.from ? t("To") : t("From")}
          min={step.from ?? floor}
          initial={step.from ?? now}
          onClose={() => setStep(null)}
          onDone={(d) =>
            step.from
              ? (setStep(null), onPick({ from: step.from, to: startOfDay(d) }))
              : setStep({ from: startOfDay(d) })
          }
        />
      )}
    </ResultPanel>
  );
}

const MINUTES = [30, 60, 90, 120, 180];
export const minutesLabel = (m: number) =>
  m < 60
    ? `${m} ${t("min")}`
    : m % 60
      ? `${Math.floor(m / 60)}h${m % 60}`
      : `${m / 60} h`;

/** Quick lengths then Custom (two wheels, in place of the list). */
export function DurationMenu({
  onPick,
  title = t("Duration"),
}: {
  onPick: (minutes: number) => void;
  title?: string;
}) {
  const [custom, setCustom] = useState(false);
  return (
    <ResultPanel testID="duration-menu" title={custom ? undefined : title}>
      {custom ? (
        <DurationSheet
          onClose={() => setCustom(false)}
          onDone={(m) => (setCustom(false), onPick(m))}
        />
      ) : (
        <>
          {MINUTES.map((m) => (
            <PanelRow
              key={m}
              testID={`duration-${m}`}
              icon="clock"
              title={minutesLabel(m)}
              onPress={() => onPick(m)}
            />
          ))}
          <PanelRow
            testID="duration-custom"
            icon="sliders"
            title={t("Custom")}
            onPress={() => setCustom(true)}
          />
        </>
      )}
    </ResultPanel>
  );
}

/** A change to apply to every tagged session; kept as a function so "+1 day" works per target. */
export type EditAction = {
  label: string;
  patch: (s: Session) => UpdateSessionInput;
};

const WINDOWS: [SessionWindow | null, string][] = [
  ["MORNING", "Morning"],
  ["AFTERNOON", "Afternoon"],
  ["EVENING", "Evening"],
  [null, "Any time"],
];
export type TextField = "title" | "location" | "note";
const FIELDS: { id: string; icon: IconName; label: string }[] = [
  { id: "move", icon: "arrow", label: "Move" },
  { id: "resize", icon: "clock", label: "Resize" },
  { id: "deadline", icon: "flag", label: "Deadline" },
  { id: "notBefore", icon: "sun", label: "Not before" },
  { id: "window", icon: "moon", label: "Part of day" },
  { id: "title", icon: "check", label: "Title" },
  { id: "location", icon: "pin", label: "Location" },
  { id: "note", icon: "plus", label: "Note" },
];

/** Field chips for an edit; each ends in `onAction` or, for text fields, `onText`. */
export function EditMenu({
  now,
  onAction,
  onText,
}: {
  now: Date;
  onAction: (a: EditAction) => void;
  onText: (f: TextField) => void;
}) {
  const [field, setField] = useState<string | null>(null);
  const [when, setWhen] = useState<{
    key: "scheduledStartTime" | "deadline" | "notBefore";
    label: string;
  } | null>(null);
  if (field === "resize")
    return (
      <DurationMenu
        title={t("Resize")}
        onPick={(m) =>
          onAction({
            label: `${t("Resize")}: ${minutesLabel(m)}`,
            patch: () => ({ durationMinutes: m }),
          })
        }
      />
    );
  if (field === "window")
    return (
      <ResultPanel title={t("Part of day")}>
        {WINDOWS.map(([w, label]) => (
          <PanelRow
            key={label}
            testID={`window-${w ?? "none"}`}
            icon="sun"
            title={t(label)}
            onPress={() =>
              onAction({
                label: `${t("Part of day")}: ${t(label)}`,
                patch: () => ({ window: w }),
              })
            }
          />
        ))}
      </ResultPanel>
    );
  return (
    <ResultPanel testID="edit-menu" title={t("Change")}>
      {field === "move" && (
        <>
          <PanelRow
            testID="move-plus-day"
            icon="arrow"
            title={t("Tomorrow, same time")}
            onPress={() =>
              onAction({
                label: t("Tomorrow, same time"),
                patch: (s) => ({
                  scheduledStartTime: addDays(
                    new Date(s.scheduledStartTime ?? now),
                    1,
                  ).toISOString(),
                }),
              })
            }
          />
          <PanelRow
            testID="move-plus-week"
            icon="arrow"
            title={t("Next week, same time")}
            onPress={() =>
              onAction({
                label: t("Next week, same time"),
                patch: (s) => ({
                  scheduledStartTime: addDays(
                    new Date(s.scheduledStartTime ?? now),
                    7,
                  ).toISOString(),
                }),
              })
            }
          />
          <PanelRow
            testID="move-pick"
            icon="calendar"
            title={t("Pick date and time")}
            onPress={() =>
              setWhen({ key: "scheduledStartTime", label: t("Move") })
            }
          />
        </>
      )}
      {!["move"].includes(field ?? "") &&
        FIELDS.map((f) => (
          <PanelRow
            key={f.id}
            testID={`field-${f.id}`}
            icon={f.icon}
            title={t(f.label)}
            onPress={() => {
              if (f.id === "title" || f.id === "location" || f.id === "note")
                onText(f.id);
              else if (f.id === "deadline" || f.id === "notBefore")
                setWhen({ key: f.id, label: t(f.label) });
              else setField(f.id);
            }}
          />
        ))}
      {when && (
        <WhenSheet
          title={when.label}
          min={now}
          onClose={() => setWhen(null)}
          onDone={(d) => {
            setWhen(null);
            onAction({
              label: `${when.label}: ${format(d, "EEE d/M HH:mm")}`,
              patch: () => ({ [when.key]: d.toISOString() }),
            });
          }}
        />
      )}
    </ResultPanel>
  );
}

/** Removable chip for a tagged task. */
export function TargetChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  return (
    <Pressable
      testID="target-chip"
      onPress={onRemove}
      className="mr-2 flex-row items-center gap-1.5 rounded-full bg-primary/15 px-3 py-1.5"
    >
      <Text
        className="max-w-[220px] text-[14px] font-semibold"
        numberOfLines={1}
      >
        {label}
      </Text>
      <Ico name="x" size={14} color={c.orange} />
    </Pressable>
  );
}

/** The `@` list: sessions filtered by what follows the `@`. */
export function MentionList({
  sessions,
  query,
  onPick,
  onPickAll,
}: {
  sessions: Session[];
  query: string;
  onPick: (s: Session) => void;
  onPickAll?: (rows: Session[]) => void;
}) {
  const q = query.trim().toLowerCase();
  const matches = sessions.filter(
    (s) => !q || s.title.toLowerCase().includes(q),
  );
  const rows = matches.slice(0, 8);
  return (
    <ResultPanel testID="mention-list" title={t("Pick a task")}>
      {rows.length === 0 ? (
        <PanelRow icon="warn" title={t("No task matches")} />
      ) : (
        <>
          {q && matches.length > 1 && onPickAll ? (
            <PanelRow
              testID="mention-all"
              icon="check"
              title={t("All {n} matching", { n: Math.min(matches.length, 20) })}
              onPress={() => onPickAll(matches)}
              selected
            />
          ) : null}
          {rows.map((s) => (
            <PanelRow
              key={s.id}
              testID={`mention-${s.id}`}
              icon="calendar"
              title={s.title}
              sub={
                s.scheduledStartTime
                  ? format(new Date(s.scheduledStartTime), "EEE d/M HH:mm")
                  : t("not placed")
              }
              onPress={() => onPick(s)}
            />
          ))}
        </>
      )}
    </ResultPanel>
  );
}
