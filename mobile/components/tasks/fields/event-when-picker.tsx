import { useLanguage } from "@/hooks/use-language";
import { DurationSlider } from "@/components/ui/duration-slider";
import { TimelineTimePicker } from "@/components/ui/timeline-time-picker";
import { WeekStripDatePicker } from "@/components/ui/week-strip-date-picker";
import { View } from "react-native";

const EVENT_MIN = 15;
const EVENT_MAX = 360;

export interface EventWhen {
  /** `YYYY-MM-DD` */
  date: string;
  /** Minutes from midnight. */
  startMin: number;
  lengthMin: number;
}

/** Date, start time and length of a fixed session. The length sets the end time. */
export function EventWhenPicker({
  value,
  disabled,
  onChange,
}: {
  value: EventWhen;
  disabled?: boolean;
  onChange: (next: EventWhen) => void;
}) {
  useLanguage();
  const { date, startMin, lengthMin } = value;
  return (
    <View className="gap-4">
      <WeekStripDatePicker
        testID="session.when.date"
        value={date}
        disabled={disabled}
        onChange={(d) => onChange({ ...value, date: d })}
      />
      <TimelineTimePicker
        testID="session.when.start"
        label="Start time"
        value={startMin}
        max={24 * 60 - lengthMin}
        disabled={disabled}
        onChange={(m) => onChange({ ...value, startMin: m })}
      />
      <DurationSlider
        testID="session.when.length"
        label="Length"
        value={lengthMin}
        min={EVENT_MIN}
        max={EVENT_MAX}
        disabled={disabled}
        onChange={(len) => onChange({ ...value, lengthMin: len })}
      />
    </View>
  );
}
