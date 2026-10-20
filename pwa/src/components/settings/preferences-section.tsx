import { useState } from "react";
import { AlarmClock, Bell, BellOff, Clock, Globe } from "lucide-react";
import {
  DEFAULT_REMINDER_CHOICES,
  type DefaultReminderChoice,
  type Lang,
  type UpdateUserInput,
  type User,
} from "@zenflow/shared";
import { Switch } from "@/components/ui/switch";
import { OptionSheet, type SheetOption } from "@/components/settings/option-sheet";
import {
  IconTile,
  Divider,
  SettingsCard,
  SettingsLabel,
  SettingsRow,
} from "@/components/settings/settings-ui";
import { saveUser } from "@/components/settings/save-user";
import { useWebPush } from "@/components/settings/use-web-push";
import { Button } from "@/components/ui/button";
import { setLanguage, t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { LANGUAGES, languageOption } from "@/lib/languages";


function reminderLabels(): Record<DefaultReminderChoice, string> {
  return {
    0: t("None"),
    5: t("5 min before"),
    10: t("10 min before"),
    15: t("15 min before"),
    30: t("30 min before"),
    60: t("1 hour before"),
  };
}

/** Language, default reminder and the notification opt-in, saved to the account. */
export function PreferencesSection({ user }: { user: User }) {
  useLanguage();
  const [sheet, setSheet] = useState<"language" | "reminder" | null>(null);
  const reminders = reminderLabels();
  const push = useWebPush();

  const languages: SheetOption<Lang>[] = LANGUAGES.map(({ value, label, flag }) => ({
    value,
    label,
    flag,
  }));
  const reminderOptions: SheetOption<DefaultReminderChoice>[] = DEFAULT_REMINDER_CHOICES.map(
    (value) => ({
      value,
      label: reminders[value],
      icon: value === 0 ? BellOff : value >= 60 ? Clock : AlarmClock,
    }),
  );

  async function save(patch: UpdateUserInput, onSaved?: () => void) {
    if (await saveUser(patch)) {
      onSaved?.();
    } else {
      errorToast(t("Couldn't save preference"), {
        description: t("Try again in a moment."),
      });
    }
  }

  const notificationHint = !push.supported
    ? push.needsInstall
      ? t("Add Zenflow to your home screen first.")
      : t("Notifications aren't supported in this browser.")
    : push.denied
      ? t("Allow them in browser settings.")
      : t("Push alerts for reminders and schedule changes");

  return (
    <>
      <SettingsLabel>{t("Preferences")}</SettingsLabel>
      <SettingsCard>
        <SettingsRow
          icon={Globe}
          title={t("Language")}
          value={`${languageOption(user.lang).flag} ${languageOption(user.lang).label}`}
          onClick={() => setSheet("language")}
        />
        <Divider />
        <SettingsRow
          icon={AlarmClock}
          title={t("Reminder")}
          value={reminders[user.defaultReminderMinutes]}
          onClick={() => setSheet("reminder")}
        />
      </SettingsCard>

      <SettingsLabel>{t("Notifications")}</SettingsLabel>
      <SettingsCard>
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <IconTile icon={Bell} />
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold">{t("Allow notifications")}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{notificationHint}</p>
          </div>
          {push.undecided ? (
            <Button size="sm" disabled={push.busy} onClick={() => void push.enable()}>
              {t("Allow")}
            </Button>
          ) : null}
          <Switch
            aria-label={t("Allow notifications")}
            checked={push.active}
            disabled={!push.canSwitch || push.busy}
            onCheckedChange={(on) => {
              if (on) void push.enable();
              else void push.disable();
            }}
          />
        </div>
      </SettingsCard>

      <OptionSheet
        open={sheet === "language"}
        onOpenChange={(open) => setSheet(open ? "language" : null)}
        title={t("Language")}
        options={languages}
        value={user.lang}
        onSelect={(lang) => void save({ lang }, () => setLanguage(lang))}
      />
      <OptionSheet
        open={sheet === "reminder"}
        onOpenChange={(open) => setSheet(open ? "reminder" : null)}
        title={t("Reminder")}
        options={reminderOptions}
        value={user.defaultReminderMinutes}
        onSelect={(defaultReminderMinutes) => void save({ defaultReminderMinutes })}
      />
    </>
  );
}
