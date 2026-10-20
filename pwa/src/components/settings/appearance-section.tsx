import { useState } from "react";
import { Moon } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { IconTile, SettingsCard, SettingsLabel } from "@/components/settings/settings-ui";
import { t, useLanguage } from "@/lib/i18n";
import { setTheme, useTheme } from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Dark mode as one switch, like mobile. "System" is the starting choice until the user flips it. */
export function AppearanceSection() {
  useLanguage();
  const theme = useTheme();
  const [systemDark] = useState(() => window.matchMedia(DARK_QUERY).matches);
  const dark = theme === "dark" || (theme === "system" && systemDark);

  return (
    <>
      <SettingsLabel>{t("Appearance")}</SettingsLabel>
      <SettingsCard>
        <div className="flex items-center gap-[13px] px-4 py-3.5">
          <IconTile icon={Moon} />
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold">{t("Dark mode")}</p>
            <p className="mt-0.5 text-[13px] text-muted-foreground">{t("Easy on the eyes at night")}</p>
          </div>
          <Switch
            aria-label={t("Dark mode")}
            checked={dark}
            onCheckedChange={(on) => setTheme(on ? "dark" : "light")}
          />
        </div>
      </SettingsCard>
    </>
  );
}
