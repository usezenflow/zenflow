import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import type { IntegrationStatus } from "@zenflow/shared";
import { logout } from "@/api/auth";
import { listIntegrations } from "@/api/integrations";
import { AdvancedSection } from "@/components/settings/advanced-section";
import { AppearanceSection } from "@/components/settings/appearance-section";
import { FinishSetupCard } from "@/components/settings/finish-setup-card";
import { IntegrationsPanel } from "@/components/settings/integrations";
import { PreferencesSection } from "@/components/settings/preferences-section";
import { ProfileRow } from "@/components/settings/profile-row";
import { SettingsCard, SettingsLabel, Divider } from "@/components/settings/settings-ui";
import { StudentCard, StudentCardSkeleton } from "@/components/settings/student-card";
import { TagsSection } from "@/components/settings/tags-section";
import { TravelSection } from "@/components/settings/travel-section";
import { useStudentProfile } from "@/components/settings/use-student-profile";
import { useWebPush } from "@/components/settings/use-web-push";
import { Skeleton } from "@/components/ui/skeleton";
import { BusyOr } from "@/components/ui/delayed-spinner";
import { useUserStore } from "@/hooks/use-user-store";
import { t, useLanguage } from "@/lib/i18n";
import { unregisterOnSignOut } from "@/lib/push/client";
import { useConnectivity } from "@/lib/connectivity";

const LMS_SECTION_ID = "settings-lms";

/** The Me screen body, in mobile's order: setup, profile, appearance, preferences, travel, tags, LMS, advanced, sign out. */
export function AccountSettings({ focusLms = false }: { focusLms?: boolean } = {}) {
  useLanguage();
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);
  const setUser = useUserStore((s) => s.setUser);
  const [integrations, setIntegrations] = useState<IntegrationStatus[] | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const push = useWebPush();
  const online = useConnectivity((s) => s.online);

  useEffect(() => {
    let active = true;
    listIntegrations()
      .then((list) => {
        if (active) setIntegrations(list);
      })
      .catch(() => {
        // The finish-setup card stays hidden when the connection state is unknown.
      });
    return () => {
      active = false;
    };
  }, []);

  const dluConnected = !!integrations?.some((i) => i.connected);
  const portalConnected = !!integrations?.some((i) => i.provider === "PORTAL" && i.connected);
  const student = useStudentProfile(portalConnected);

  // A link to the LMS settings (`?focus=dlu`) lands on the section once the screen has drawn.
  useEffect(() => {
    if (!focusLms || !user) return;
    const id = window.setTimeout(openLms, 300);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLms, user]);

  if (!user) {
    return (
      <SettingsCard className="mt-4">
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <Skeleton className="size-[46px] rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      </SettingsCard>
    );
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await unregisterOnSignOut();
      await logout();
    } catch {
      // Sign the user out locally even if the request fails.
    } finally {
      setUser(null);
      navigate("/login");
    }
  }

  function openLms() {
    document.getElementById(LMS_SECTION_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      {!online ? (
        <SettingsCard className="mt-4 px-4 py-3 text-[13px] text-muted-foreground">
          {t("You're offline. Changes need a connection.")}
        </SettingsCard>
      ) : null}

      {integrations ? (
        <div className="mt-4">
          <FinishSetupCard
            notificationsActive={push.active || !push.supported}
            dluConnected={dluConnected}
            onPress={(item) => {
              if (item === "notifications") void push.enable();
              else openLms();
            }}
          />
        </div>
      ) : null}

      <SettingsLabel>{t("Profile")}</SettingsLabel>
      <SettingsCard>
        <ProfileRow user={user} />
        {student ? (
          <>
            <Divider />
            <StudentCard profile={student} />
          </>
        ) : portalConnected ? (
          <>
            <Divider />
            <StudentCardSkeleton />
          </>
        ) : null}
      </SettingsCard>

      <AppearanceSection />
      <PreferencesSection user={user} />
      <TravelSection user={user} />
      <TagsSection />

      <div id={LMS_SECTION_ID} className="scroll-mt-4">
        <SettingsLabel>{t("LMS and portal")}</SettingsLabel>
        <IntegrationsPanel />
      </div>

      <AdvancedSection />

      <SettingsLabel>{t("Account")}</SettingsLabel>
      <SettingsCard>
        <button
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
          className="flex w-full items-center gap-[13px] px-4 py-3.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
        >
          <span className="flex size-[38px] shrink-0 items-center justify-center rounded-xl bg-muted">
            <BusyOr busy={signingOut} className="size-[18px] text-destructive">
              <LogOut className="size-[18px] text-destructive" />
            </BusyOr>
          </span>
          <span className="text-[16px] font-semibold text-destructive">
            {signingOut ? t("Signing out…") : t("Sign out")}
          </span>
        </button>
      </SettingsCard>
    </>
  );
}
