import { useLanguage } from "@/hooks/use-language";
import { ChipGroup } from "@/components/ui/chip-group";
import { DurationSlider, durationLabel } from "@/components/ui/duration-slider";
import { useState } from "react";
import { View } from "react-native";

const DURATION_CHOICES = [30, 60, 120, 180] as const;
/** Longest length the slider offers, in minutes. */
const DURATION_MAX = 480;

/** A plan's length: chips (30 min, 1 h, 2 h, 3 h) and Custom, a slider in 15 minute steps. */
export function DurationPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (minutes: number) => void;
  disabled?: boolean;
}) {
  useLanguage();
  const [customOpen, setCustomOpen] = useState(false);
  const isChoice = (DURATION_CHOICES as readonly number[]).includes(value);
  const customActive = customOpen || !isChoice;

  return (
    <View className="gap-3">
      <ChipGroup<string>
        testID="session.duration.chip"
        value={customActive ? null : String(value)}
        disabled={disabled}
        onChange={(v) => {
          setCustomOpen(false);
          onChange(Number(v));
        }}
        onCustom={() => setCustomOpen(true)}
        customActive={customActive}
        options={DURATION_CHOICES.map((m) => ({ value: String(m), label: durationLabel(m) }))}
      />
      {customActive && (
        <DurationSlider
          testID="session.duration.slider"
          label="Duration"
          value={Math.min(value, DURATION_MAX)}
          max={DURATION_MAX}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </View>
  );
}
