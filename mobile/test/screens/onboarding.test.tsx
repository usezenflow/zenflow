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
    defaultReminder: 10,
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
vi.mock("@/components/settings/travel-section", () => ({
  TravelSection: () => <div data-testid="travel-section" />,
}));
vi.mock("@/components/settings/dlu-accounts-section", () => ({
  DluAccountsSection: () => <div data-testid="dlu-section" />,
}));

const BASIC_INFO = `${API}/users/update/basic-info`;

let patches: Record<string, unknown>[];

beforeEach(() => {
  patches = [];
  notif.active = false;
  notif.permissionGranted = false;
  notif.update.mockResolvedValue(true);
  notif.setEnabled.mockResolvedValue(true);
  useUserStore.setState({ user: { ...testUser, onboardedAt: null } as never, loading: false });
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
const secondary = () => screen.getByTestId("onboarding.secondary");
const next = async (title: string) =>
  waitFor(() => expect(screen.getByText(title)).toBeTruthy());

// The first step is the LMS and portal; the name step was removed (the DLU name fills it on first sync).
const TITLES = [
  "Connect your LMS or portal",
  "Plan your commute",
  "Stay ahead of deadlines",
  "Connect an AI assistant",
  "You’re all set",
];

/** Skip forward (secondary button) until `title` shows, awaiting each hop. */
async function skipTo(title: string) {
  for (const hop of TITLES.slice(1, TITLES.indexOf(title) + 1)) {
    fireEvent.click(secondary());
    await next(hop);
  }
}

describe("OnboardingScreen", () => {
  it("starts on the LMS step with no back button", () => {
    renderScreen(<OnboardingScreen />);
    expect(screen.getByText("Connect your LMS or portal")).toBeTruthy();
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("goes back a step and hides Back again on the first step", async () => {
    renderScreen(<OnboardingScreen />);
    fireEvent.click(secondary());
    await next("Plan your commute");
    fireEvent.click(screen.getByLabelText("Back"));
    await next("Connect your LMS or portal");
    expect(screen.queryByLabelText("Back")).toBeNull();
  });

  it("offers Skip for now on the LMS step while nothing is connected", async () => {
    renderScreen(<OnboardingScreen />);
    await skipTo("Connect your LMS or portal");
    expect(screen.getByTestId("dlu-section")).toBeTruthy();
    expect(screen.getByText("Skip for now")).toBeTruthy();
  });

  it("hides Skip for now on the LMS step once an account is connected", async () => {
    server.use(
      http.get(`${API}/integrations`, () =>
        HttpResponse.json({
          data: { integrations: [{ provider: "PORTAL", connected: true }] },
        }),
      ),
    );
    renderScreen(<OnboardingScreen />);
    await skipTo("Connect your LMS or portal");
    await waitFor(() => expect(screen.queryByText("Skip for now")).toBeNull());
  });

  describe("notifications step", () => {
    async function openNotifications() {
      renderScreen(<OnboardingScreen />);
      await skipTo("Stay ahead of deadlines");
    }

    it("turns notifications on quietly and advances", async () => {
      await openNotifications();
      fireEvent.click(primary());
      await next("Connect an AI assistant");
      expect(notif.setEnabled).toHaveBeenCalledWith(true, { quiet: true });
    });

    it("shows the blocked hint and stays when permission is denied", async () => {
      notif.setEnabled.mockResolvedValue(false);
      await openNotifications();
      fireEvent.click(primary());
      await waitFor(() => expect(screen.getByText("Notifications are blocked")).toBeTruthy());
      expect(screen.getByText("Stay ahead of deadlines")).toBeTruthy();
      expect(screen.getAllByText("Open system settings").length).toBeGreaterThan(0);
    });

    it("'Not now' turns notifications off and advances", async () => {
      await openNotifications();
      fireEvent.click(screen.getByText("Not now"));
      await next("Connect an AI assistant");
      expect(notif.setEnabled).toHaveBeenCalledWith(false);
    });

    it("reflects the active state on the switch and offers Continue", async () => {
      notif.active = true;
      await openNotifications();
      const toggle = screen.getByTestId("onboarding.notifications-switch");
      expect(toggle.getAttribute("aria-checked")).toBe("true");
      expect(screen.queryByText("Not now")).toBeNull();
      expect(screen.getByText("Continue")).toBeTruthy();
    });
  });

  describe("finish", () => {
    async function openSummary() {
      renderScreen(<OnboardingScreen />);
      await skipTo("You’re all set");
    }

    it("has no timezone or reminder steps", async () => {
      await openSummary();
      expect(screen.queryByText("Where are you?")).toBeNull();
      expect(screen.queryByText("Default reminder")).toBeNull();
    });

    it("lists skipped steps on the summary and reopens one, returning to the summary", async () => {
      await openSummary();
      const setUp = screen.getAllByText("Set up");
      expect(setUp.length).toBe(3); // LMS, commute and notifications were skipped
      fireEvent.click(setUp[0]);
      await next("Connect your LMS or portal");
      fireEvent.click(primary());
      await next("You’re all set");
    });

    it("completes onboarding", async () => {
      await openSummary();
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(patches).toContainEqual({ onboarded: true }));
    });

    it("toasts and stays on the summary when completing fails", async () => {
      await openSummary();
      server.use(http.patch(BASIC_INFO, () => HttpResponse.json({ message: "no" }, { status: 500 })));
      fireEvent.click(screen.getByText("Open my calendar"));
      await waitFor(() => expect(screen.getByText("Couldn't save")).toBeTruthy());
      expect(screen.getByText("You’re all set")).toBeTruthy();
    });
  });
});
