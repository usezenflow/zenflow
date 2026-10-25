import { me } from "@/api/auth";
import { BootScreen } from "@/components/brand/boot-screen";
import { useUserStore } from "@/hooks/use-user-store";
import { clearOfflineCache, readUser, writeUser } from "@/lib/offline/cache";
import { isAxiosError } from "axios";
import { useEffect } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";

/**
 * Gate authenticated routes. Redirects to /login when unauthenticated, and to
 * /onboarding until the user has finished it (`onboardedAt` is null).
 */
export function WithAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, loading, setLoading, setUser } = useUserStore();

  useEffect(() => {
    if (!user && !loading) {
      setLoading(true);
      me()
        .then((data) => {
          setUser(data);
          if (data) void writeUser(data);
        })
        .catch(async (error) => {
          const status = isAxiosError(error) ? error.response?.status : undefined;
          if (status === 401 || status === 403) {
            await clearOfflineCache();
          } else {
            // No answer (offline) or a server error: a saved user keeps the calendar open.
            const saved = await readUser();
            if (saved) {
              setUser(saved);
              return;
            }
          }
          navigate(`/login?callback=${encodeURIComponent(location.pathname + location.search)}`);
        })
        .finally(() => {
          // Always clear the flag — otherwise a failed pre-login `me()` leaves
          // `loading` stuck `true`, and after login `WithAuth` renders null
          // (blank page) because of the `if (loading) return null` guard.
          setLoading(false);
        });
    }
  }, [user, loading, location.pathname]);

  // Render the protected children only once we have an authenticated user.
  // Until `me()` resolves we show the boot screen, not the children: this keeps
  // an unauthenticated visit to `/` from mounting the calendar and firing
  // protected requests (`/sessions`, …) that 403 and spray "Forbidden
  // resource" toasts before the redirect to /login lands. The effect above
  // either sets the user or navigates away.
  if (loading || !user) return <BootScreen />;

  if (
    !user.onboardedAt &&
    location.pathname !== "/onboarding" &&
    location.pathname !== "/oauth/consent"
  ) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
}
