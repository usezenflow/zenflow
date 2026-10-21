import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Slider } from "@/components/ui/slider";
import { t, useLanguage } from "@/lib/i18n";
import { localizedReminderLabel, localizedReminderLeadLabel } from "@/lib/reminder-label";
import { cn } from "@/lib/utils";
import {
  REMINDER_UNITS,
  type ReminderUnitId,
  customReminderMinutes,
  reminderError,
  upsertReminder,
} from "@zenflow/core";
import { MAX_REMINDERS_PER_SESSION } from "@zenflow/shared";
import { Bell, Minus, Plus, X } from "lucide-react";
import { useState } from "react";

/** Quick lead times offered as chips. The rest of the range is Custom. */
const QUICK = [0, 15, 60, 1440] as const;

/** Largest amount per unit: up to seven days before, as the core rule allows. */
const MAX_AMOUNT: Record<ReminderUnitId, number> = {
  min: 59,
  hour: 23,
  day: 7,
  week: 1,
};

/** What the panel is open for: an existing reminder's minutes, or a new one. */
type Target = number | "add";

/**
 * Reminders as chips, plus one panel for adding or changing one. The panel
 * offers four quick lead times and a Custom amount (unit chips and a stepper),
 * so no text input is needed. Values are minutes before start, kept longest
 * lead first, and no two may share a lead time.
 */
export function ReminderField({
  value,
  onChange,
  disabled,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
}) {
  useLanguage();
  const [target, setTarget] = useState<Target | null>(null);
  const [custom, setCustom] = useState(false);
  const [unit, setUnit] = useState<ReminderUnitId>("hour");
  const [amount, setAmount] = useState(1);
  const full = value.length >= MAX_REMINDERS_PER_SESSION;

  const current = target === null || target === "add" ? undefined : target;
  const others = value.filter((m) => m !== current);
  const unitMinutes = REMINDER_UNITS.find((u) => u.id === unit)!.minutes;
  const customMinutes = customReminderMinutes(String(amount), unitMinutes);
  const customError = reminderError(customMinutes, others);

  function openFor(next: Target) {
    setTarget(next);
    setCustom(false);
    setUnit("hour");
    setAmount(1);
  }

  function apply(minutes: number) {
    onChange(upsertReminder(value, minutes, current));
    setTarget(null);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {value.map((m) => (
          <span
            key={m}
            className={cn(
              "flex items-center rounded-full border border-primary/45 bg-primary/15",
              disabled && "opacity-50",
            )}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => openFor(m)}
              aria-label={t("Edit reminder: {reminder}", { reminder: localizedReminderLabel(m) })}
              className="flex h-8 items-center gap-1.5 pl-3 pr-1.5 text-[13px] font-medium text-primary"
            >
              <Bell className="size-3.5" />
              {localizedReminderLabel(m)}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onChange(value.filter((x) => x !== m))}
              aria-label={t("Remove reminder: {reminder}", { reminder: localizedReminderLabel(m) })}
              className="mr-1.5 flex size-5 items-center justify-center rounded-full bg-primary/20 text-primary"
            >
              <X className="size-[11px]" />
            </button>
          </span>
        ))}
        {!full && target === null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => openFor("add")}
            className={cn(
              "flex h-8 items-center gap-1.5 rounded-full border border-dashed border-border px-3 text-[13px] font-medium text-muted-foreground",
              disabled && "opacity-50",
            )}
          >
            <Plus className="size-3.5" />
            {t("Add reminder")}
          </button>
        )}
      </div>

      {target !== null && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/60 p-3">
          <span className="text-[13px] font-semibold">
            {current === undefined ? t("How long before it starts?") : t("Change reminder")}
          </span>
          {!custom ? (
            <div className="flex flex-wrap gap-1.5">
              {QUICK.filter((m) => !others.includes(m)).map((m) => (
                <Chip key={m} selected={current === m} onClick={() => apply(m)}>
                  {localizedReminderLeadLabel(m)}
                </Chip>
              ))}
              <Chip selected={false} onClick={() => setCustom(true)}>
                {t("Custom")}
              </Chip>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-1.5">
                {REMINDER_UNITS.map((u) => (
                  <Chip
                    key={u.id}
                    selected={unit === u.id}
                    onClick={() => {
                      setUnit(u.id);
                      setAmount(1);
                    }}
                  >
                    {t(u.id)}
                  </Chip>
                ))}
              </div>
              <ReminderAmount
                label="Amount"
                value={amount}
                min={1}
                max={MAX_AMOUNT[unit]}
                valueLabel={(n) => `${n} ${t(unit)}`}
                onChange={setAmount}
              />
              {customError && (
                <span className="text-[12.5px] font-medium text-destructive">{t(customError)}</span>
              )}
              <Button
                type="button"
                className="w-full"
                disabled={customError !== null}
                onClick={() => apply(customMinutes)}
              >
                {current === undefined ? t("Add reminder") : t("Save")}
              </Button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setTarget(null)}
            className="flex min-h-11 items-center justify-center text-[13px] font-medium text-muted-foreground"
          >
            {t("Cancel")}
          </button>
        </div>
      )}

      {full && (
        <span className="text-[12.5px] leading-snug text-muted-foreground">
          {t("{count} of {max} reminders set. Tap one to change it.", {
            count: value.length,
            max: MAX_REMINDERS_PER_SESSION,
          })}
        </span>
      )}
    </div>
  );
}

/** A −/+ pair around a readout, with a slider under it for bigger jumps. */
function ReminderAmount({
  label,
  value,
  min,
  max,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  valueLabel: (value: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("Decrease {field}", { field: t(label) })}
          disabled={value <= min}
          onClick={() => onChange(value - 1)}
        >
          <Minus />
        </Button>
        <span className="flex-1 text-center text-[17px] font-semibold tabular-nums" aria-live="polite">
          {valueLabel(value)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-sm"
          aria-label={t("Increase {field}", { field: t(label) })}
          disabled={value >= max}
          onClick={() => onChange(value + 1)}
        >
          <Plus />
        </Button>
      </div>
      <Slider min={min} max={max} step={1} value={[value]} onValueChange={([v]) => onChange(v)} />
    </div>
  );
}
