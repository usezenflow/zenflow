import { getDeadlineOptions } from "@/api/tasks";
import { useLanguage } from "@/hooks/use-language";
import { format as localFormat, t } from "@/lib/i18n";
import { ChipGroup } from "@/components/ui/chip-group";
import { TimelineTimePicker } from "@/components/ui/timeline-time-picker";
import { WeekStripDatePicker } from "@/components/ui/week-strip-date-picker";
import { zonedDate, zonedNow, zonedWallClockToUtc } from "@zenflow/core";
import type { DeadlineOptionsResponse } from "@zenflow/shared";
import { format as dateFnsFormat, isSameDay } from "date-fns";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { END_OF_DAY, END_OF_DAY_SECONDS, isoAt, todayIn } from "./time";

type DeadlineChipId = "today" | "tomorrow" | "thisWeek" | "nextWeek" | "noRush";

const DEADLINE_CHIPS: { value: DeadlineChipId; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "thisWeek", label: "This week" },
  { value: "nextWeek", label: "Next week" },
  { value: "noRush", label: "No rush" },
];

/** Which quick chip a deadline instant matches, or `null` for a custom one. */
function chipOf(
  value: string,
  options: DeadlineOptionsResponse | null,
  tz: string,
): DeadlineChipId | null {
  if (!value || !options) return null;
  if (value === options.noRush) return "noRush";
  if (value === options.thisWeek) return "thisWeek";
  if (value === options.nextWeek) return "nextWeek";
  const due = zonedDate(value, tz);
  if (isSameDay(due, zonedDate(options.today, tz))) return "today";
  if (isSameDay(due, zonedDate(options.tomorrow, tz))) return "tomorrow";
  return null;
}

/**
 * A deadline as quick chips (today, tomorrow, this week, next week, no rush)
 * and Custom, which reveals a date strip and a time. No card around it: the
 * session view shows it inline under its row.
 */
export function DeadlinePicker({
  value,
  tz,
  onChange,
  disabled,
  defaultToNoRush = false,
}: {
  value: string;
  tz: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  /** A plan without a deadline yet starts on "No rush". */
  defaultToNoRush?: boolean;
}) {
  useLanguage();
  const [options, setOptions] = useState<DeadlineOptionsResponse | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const chip = chipOf(value, options, tz);
  const customActive = customOpen || (!!value && chip === null);

  useEffect(() => {
    const anchor = zonedWallClockToUtc(zonedNow(tz), tz).toISOString();
    getDeadlineOptions(anchor)
      .then(setOptions)
      .catch(() => setOptions(null));
  }, [tz]);

  useEffect(() => {
    if (defaultToNoRush && !value && options) onChange(options.noRush);
  }, [defaultToNoRush, options, value, onChange]);

  function pick(id: DeadlineChipId) {
    setCustomOpen(false);
    if (options) onChange(options[id]);
  }

  function openCustom() {
    setCustomOpen(true);
    if (!value) onChange(isoAt(todayIn(tz), END_OF_DAY, tz, END_OF_DAY_SECONDS));
  }

  const due = value ? zonedDate(value, tz) : null;
  const customDate = due ? dateFnsFormat(due, "yyyy-MM-dd") : todayIn(tz);
  const customMinutes = due ? due.getHours() * 60 + due.getMinutes() : END_OF_DAY;

  return (
    <View className="gap-3">
      <ChipGroup<DeadlineChipId>
        testID="session.deadline.chip"
        value={customActive ? null : chip}
        disabled={disabled || !options}
        onChange={pick}
        onCustom={openCustom}
        customActive={customActive}
        options={DEADLINE_CHIPS}
      />
      {customActive && (
        <View className="gap-4">
          <WeekStripDatePicker
            testID="session.deadline.date"
            value={customDate}
            minDate={todayIn(tz)}
            disabled={disabled}
            onChange={(date) => onChange(isoAt(date, customMinutes, tz))}
          />
          <TimelineTimePicker
            testID="session.deadline.time"
            label="Deadline time"
            value={customMinutes}
            disabled={disabled}
            onChange={(minutes) => onChange(isoAt(customDate, minutes, tz))}
          />
        </View>
      )}
    </View>
  );
}

/** The deadline as a short line for its row, e.g. `Due Tue 20 Oct, 23:59`. */
export function deadlineLine(value: string, tz: string, empty: string): string {
  if (!value) return empty;
  return t("Due {when}", { when: localFormat(zonedDate(value, tz), "EEE d MMM, HH:mm") });
}
