import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OnboardingScreen from "@/app/(onboarding)/index";
import { useIntegrationStore } from "@/hooks/use-integration-store";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

// One mutable stand-in for the shared notification mechanism (it has its own
// rules; here we only drive the onboarding steps around it).
const notif = vi.hoisted(() => ({
  active: false,
  permissionGranted: false,
  ready: true,
  prefs: {
    language: "en",
    timezone: "Asia/Ho_Chi_Minh",
    timezoneMode: "device",
  },
  update: vi.fn(async () => true),
  setEnabled: vi.fn(async () => true),
}));

vi.mock("@/hooks/use-notification-toggle", () => ({
  useNotificationToggle: () => notif,
}));
vi.mock("@/hooks/use-push-status-store", () => ({
  usePushStatusStore: Object.assign(() => null, {
    getState: () => ({ permission: "denied", refresh: vi.fn(async () => {}) }),
  }),
}));
vi.mock("@/components/onboarding/campus-step", () => ({
  CampusStep: () => <div data-testid="campus-step" />,
}));
vi.mock("@/components/onboarding/assistants-step", () => ({
  AssistantsStep: () => <div data-testid="assistants-step" />,
}));
vi.mock("@/components/onboarding/calendar-step", () => ({
  CalendarStep: ({
    onEnableNotifications,
  }: {
    onEnableNotifications: () => void;
  }) => (
    <button
      type="button"
      data-testid="onboarding.notifications-switch"
      onClick={onEnableNotifications}
    />
  ),
}));

const BASIC_INFO = `${API}/users/update/basic-info`;

let patches: Record<string, unknown>[];

beforeEach(() => {
  patches = [];
  notif.active = false;
  notif.permissionGranted = false;
  notif.update.mockResolvedValue(true);
  notif.setEnabled.mockResolvedValue(true);
  useUserStore.setState({
    user: { ...testUser, onboardedAt: null } as never,
    loading: false,
  });
  useIntegrationStore.setState({ integrations: [], loading: true });
  server.use(
    http.patch(BASIC_INFO, async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>;
      patches.push(body);
      return HttpResponse.json({ data: { ...testUser, ...body } });
    }),
  );
});

const primary = () => screen.getByTestId("onboarding.primary");

describe("OnboardingScreen", () => {
  it("shows the three rows with the campus row open", () => {
    renderScreen(<OnboardingScreen />);
    expect(screen.getByText("Connect your apps")).toBeTruthy();
    expect(screen.getByTestId("campus-step")).toBeTruthy();
    expect(screen.queryByTestId("assistants-step")).toBeNull();
  });

  it("opens one row at a time", () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(screen.getByTestId("onboarding.row.assistants"));
    expect(screen.getByTestId("assistants-step")).toBeTruthy();
    expect(screen.queryByTestId("campus-step")).toBeNull();
  });

  it("turns notifications on from the calendar row", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(screen.getByTestId("onboarding.row.calendar"));
    fireEvent.click(screen.getByTestId("onboarding.notifications-switch"));
    await waitFor(() =>
      expect(notif.setEnabled).toHaveBeenCalledWith(true, { quiet: true }),
    );
  });

  describe("finish", () => {
    it("offers to skip until campus is connected", () => {
      renderScreen(<OnboardingScreen />);
      expect(screen.getByText("Skip for now")).toBeTruthy();
    });

    it("opens the calendar once campus is connected", async () => {
      useIntegrationStore.setState({
        integrations: [{ provider: "DLU", connected: true }] as never,
        loading: false,
      });
      renderScreen(<OnboardingScreen />);
      fireEvent.click(await screen.findByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
    });

    it("completes onboarding even when everything is skipped", async () => {
      renderScreen(<OnboardingScreen />);
      fireEvent.click(primary());
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
    });

    it("toasts when completing fails", async () => {
      server.use(
        http.patch(BASIC_INFO, () =>
          HttpResponse.json({ message: "no" }, { status: 500 }),
        ),
      );
      renderScreen(<OnboardingScreen />);
      fireEvent.click(primary());
      await waitFor(() =>
        expect(screen.getByText("Couldn't save")).toBeTruthy(),
      );
    });
  });
});
