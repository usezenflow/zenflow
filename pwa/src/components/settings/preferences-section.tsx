import { useState } from "react";
import { Bell, Globe } from "lucide-react";
import { type Lang, type UpdateUserInput, type User } from "@zenflow/shared";
import { Switch } from "@/components/ui/switch";
import { OptionSheet, type SheetOption } from "@/components/settings/option-sheet";
import {
  IconTile,
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

/** Language and the notification opt-in, saved to the account. */
export function PreferencesSection({ user }: { user: User }) {
  useLanguage();
  const [sheet, setSheet] = useState<"language" | null>(null);
  const push = useWebPush();

  const languages: SheetOption<Lang>[] = LANGUAGES.map(({ value, label, flag }) => ({
    value,
    label,
    flag,
  }));

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
      : t("Push alerts for schedule changes and sync problems");

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
    </>
  );
}
