import { useState } from "react";
import { BarChart3, ChevronDown, Clock } from "lucide-react";
import { AiAssistantsSection } from "@/components/settings/ai-assistants-section";
import { StorageSection } from "@/components/settings/storage-section";
import { TimezoneSheet } from "@/components/settings/timezone-sheet";
import { UserPreferencesPanel } from "@/components/settings/preferences";
import { Divider, SettingsCard, SettingsLabel, SettingsRow } from "@/components/settings/settings-ui";
import { useUserStore } from "@/hooks/use-user-store";
import { t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Advanced group, collapsed by default: timezone, storage, AI assistant access and the preference map. */
export function AdvancedSection() {
  useLanguage();
  const user = useUserStore((s) => s.user);
  const [open, setOpen] = useState(false);
  const [timezoneOpen, setTimezoneOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);

  if (!user) return null;

  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="mx-1 mb-2 mt-[22px] flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        {t("Advanced")}
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>

      {open ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 duration-200">
          <SettingsCard>
            <SettingsRow
              icon={Clock}
              title={t("Timezone")}
              value={user.timezone}
              onClick={() => setTimezoneOpen(true)}
            />
          </SettingsCard>
          <TimezoneSheet open={timezoneOpen} onOpenChange={setTimezoneOpen} value={user.timezone} />

          <StorageSection />

          <AiAssistantsSection />

          <SettingsLabel>{t("Preference map")}</SettingsLabel>
          <SettingsCard>
            <SettingsRow
              icon={BarChart3}
              title={mapOpen ? t("Hide preference map") : t("Show preference map")}
              onClick={() => setMapOpen((current) => !current)}
            />
            {mapOpen ? (
              <>
                <Divider />
                <div className="px-4 py-4">
                  <UserPreferencesPanel />
                </div>
              </>
            ) : null}
          </SettingsCard>
        </div>
      ) : null}
    </>
  );
}
