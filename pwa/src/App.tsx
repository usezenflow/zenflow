import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/sonner";
import { DelayedSpinner } from "@/components/ui/delayed-spinner";
import { ErrorBoundary } from "@/components/error-boundary";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

const HomePage = lazy(() => import("./pages/home"));
const LoginPage = lazy(() => import("./pages/login"));
const OnboardingPage = lazy(() => import("./pages/onboarding"));
const NotFoundPage = lazy(() => import("./pages/not-found"));

/**
 * Routes. Signed-in users who have not finished onboarding are sent to
 * `/onboarding` by `WithAuth`. Mirrors `mobile/app/_layout.tsx`'s `AuthGate`.
 * Each page is its own chunk, so the first load only pays for the screen it shows.
 */
function App() {
  return (
    <BrowserRouter>
      <Toaster />
      <ErrorBoundary>
        <Suspense
          fallback={
            <div className="flex h-dvh items-center justify-center">
              <DelayedSpinner busy className="size-5 text-primary" />
            </div>
          }
        >
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/onboarding" element={<OnboardingPage />} />
            {/* Push payloads from older builds may still point here. */}
            <Route path="/notifications" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

export default App;
