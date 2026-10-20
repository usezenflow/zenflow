import { Fragment } from "react";
import { Check, type LucideIcon } from "lucide-react";
import { Divider, SettingsCard, SettingsSheet } from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";

export interface SheetOption<T extends string | number> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** A flag emoji shown before the label. */
  flag?: string;
}

/** Single-choice sheet for a settings row: picks a value and closes. */
export function OptionSheet<T extends string | number>({
  open,
  onOpenChange,
  title,
  options,
  value,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  options: readonly SheetOption<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  return (
    <SettingsSheet open={open} onOpenChange={onOpenChange} title={title}>
      <SettingsCard>
        <div role="radiogroup" className="flex flex-col">
          {options.map((option, i) => {
            const selected = option.value === value;
            const Icon = option.icon;
            return (
              <Fragment key={String(option.value)}>
                {i > 0 && <Divider />}
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    onSelect(option.value);
                    onOpenChange(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-[13px] px-4 py-3 text-left transition-colors hover:bg-muted/50",
                    selected && "bg-primary/[0.06]",
                  )}
                >
                  {option.flag ? (
                    <span aria-hidden className="flex size-[38px] shrink-0 items-center justify-center text-[20px] leading-none">
                      {option.flag}
                    </span>
                  ) : null}
                  {Icon ? (
                    <span
                      className={cn(
                        "flex size-[38px] shrink-0 items-center justify-center rounded-xl",
                        selected ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
                      )}
                    >
                      <Icon className="size-[18px]" />
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-[16px]",
                      selected ? "font-semibold text-primary" : "font-medium text-foreground",
                    )}
                  >
                    {option.label}
                  </span>
                  {selected ? <Check className="size-[18px] shrink-0 text-primary" /> : null}
                </button>
              </Fragment>
            );
          })}
        </div>
      </SettingsCard>
    </SettingsSheet>
  );
}
