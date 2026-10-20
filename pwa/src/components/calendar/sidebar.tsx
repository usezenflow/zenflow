import { useUserStore } from "@/hooks/use-user-store";
import { Logo } from "@/components/logo";
import { logout } from "@/api/auth";
import { unregisterOnSignOut } from "@/lib/push/client";
import { t } from "@/lib/i18n";
import { LogOut, Settings } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SessionAgenda } from "./session-agenda";

/** Footer with the signed-in user, a Settings button, and Log out. */
function SidebarFooter() {
  const navigate = useNavigate();
  const user = useUserStore((s) => s.user);

  async function handleLogout() {
    try {
      // Drop this browser's push subscription before the session ends.
      await unregisterOnSignOut().catch(() => {});
      await logout();
    } catch {
      // Sign the user out locally even if the request fails.
    } finally {
      useUserStore.getState().setUser(null);
      navigate("/login");
    }
  }

  // Settings lives in a dialog mounted once in layout.tsx; request it via a
  // window event so the rail and the mobile drawer share one dialog instance.
  function openSettings() {
    window.dispatchEvent(new CustomEvent("zenflow:open-settings"));
  }

  const identity = user?.name || user?.email || t("Account");
  const initial = (user?.name || user?.email || "?").charAt(0).toUpperCase();

  return (
    <div className="space-y-2 border-t border-sidebar-border pt-3">
      <button
        type="button"
        onClick={openSettings}
        className="flex w-full items-center gap-2.5 rounded-full px-2 py-2 text-left transition-colors hover:bg-sidebar-accent"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initial}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">
            {identity}
          </span>
          {user?.name && user?.email && (
            <span className="block truncate text-[11px] text-muted-foreground">
              {user.email}
            </span>
          )}
        </span>
        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <button
        type="button"
        onClick={handleLogout}
        className="flex w-full items-center gap-2 rounded-full px-2 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
      >
        <LogOut className="h-3.5 w-3.5" /> {t("Log out")}
      </button>
    </div>
  );
}

/** Desktop rail, hidden below `lg` where the content moves into a drawer. */
export function CalendarSidebar() {
  return (
    <aside className="glass-frosted hidden w-80 xl:w-96 shrink-0 overflow-hidden rounded-none border-y-0 border-l-0 border-r border-sidebar-border lg:block">
      <SidebarBody />
    </aside>
  );
}

/** The sidebar's inner content, reused by the desktop rail and the mobile drawer. */
export function SidebarBody() {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <Logo className="h-9 w-9 shrink-0" />
        <span className="text-xl font-semibold tracking-tight">Zenflow</span>
      </div>

      <SessionAgenda />

      <SidebarFooter />
    </div>
  );
}
