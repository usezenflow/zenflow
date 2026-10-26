import { AccountSettings } from "@/components/settings/account-settings";
import { Logo } from "@/components/logo";
import { t, useLanguage } from "@/lib/i18n";

/** The signed-in home: setup and account, nothing else. */
export function SettingsPage({ focusLms = false }: { focusLms?: boolean }) {
  useLanguage();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-4 pb-16 pt-6 lg:max-w-6xl lg:px-8">
      <header className="flex items-center gap-3">
        <Logo className="size-9" />
        <h1 className="text-xl font-semibold">{t("Settings")}</h1>
      </header>
      <AccountSettings focusLms={focusLms} />
    </main>
  );
}
