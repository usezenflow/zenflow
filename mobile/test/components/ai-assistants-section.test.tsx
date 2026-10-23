import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { AiAssistantsSection } from "@/components/settings/ai-assistants-section";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const CHATGPT = {
  id: "t1",
  name: "ChatGPT",
  createdAt: "2026-10-12T08:00:00.000Z",
  lastUsedAt: null,
};

function accessWith(tokens: unknown[]) {
  return http.get(`${API}/users/me/api-access`, () =>
    HttpResponse.json({
      data: {
        mcpUrl: `${API}/mcp`,
        restBaseUrl: API,
        prompt: "Use the Zenflow tools.",
        setup: [
          { id: "claude", label: "Claude", steps: ["Mở claude.ai."] },
          { id: "gemini", label: "Gemini", steps: ["Mở settings.json."], code: "{}" },
        ],
        tokens,
      },
    }),
  );
}

beforeEach(() => {
  useUserStore.setState({
    user: { ...testUser, lang: "en", timezone: "Asia/Ho_Chi_Minh" } as never,
    loading: false,
  });
});

describe("AiAssistantsSection", () => {
  it("lists the endpoints and the existing tokens", async () => {
    server.use(accessWith([CHATGPT]));
    renderScreen(<AiAssistantsSection />);
    expect(await screen.findByText("ChatGPT")).toBeTruthy();
    expect(screen.getByText(`${API}/mcp`)).toBeTruthy();
    expect(screen.getByText("Never used")).toBeTruthy();
  });

  it("shows a new secret once and hides it when the sheet closes", async () => {
    server.use(
      accessWith([]),
      http.post(`${API}/users/me/api-access/tokens`, () =>
        HttpResponse.json({
          data: { token: { ...CHATGPT, id: "t2", name: "Claude" }, secret: "zf_secret_123" },
        }),
      ),
    );
    renderScreen(<AiAssistantsSection />);
    fireEvent.click(await screen.findByTestId("api-access.create"));
    fireEvent.change(await screen.findByTestId("api-token.name"), {
      target: { value: "Claude" },
    });
    fireEvent.click(screen.getByTestId("api-token.create"));
    expect((await screen.findByTestId("api-token.secret")).textContent).toBe("zf_secret_123");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByText("zf_secret_123")).toBeNull());
  });

  it("asks before revoking a token", async () => {
    let revoked = false;
    server.use(
      accessWith([CHATGPT]),
      http.delete(`${API}/users/me/api-access/tokens/t1`, () => {
        revoked = true;
        return HttpResponse.json({ data: { revoked: true } });
      }),
    );
    renderScreen(<AiAssistantsSection />);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke ChatGPT?" }));
    expect(revoked).toBe(false);
    // The confirm toast renders after the row, and its buttons have no role.
    const labels = await screen.findAllByText("Revoke");
    fireEvent.click(labels[labels.length - 1]);
    await waitFor(() => expect(screen.queryByText("ChatGPT")).toBeNull());
    expect(revoked).toBe(true);
  });
});
