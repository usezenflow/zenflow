import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { AiAssistantsSection } from "@/components/settings/ai-assistants-section";
import { useUserStore } from "@/hooks/use-user-store";
import { API, testUser } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

function access() {
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
  it("lists the endpoints and the setup guides, with no token controls", async () => {
    server.use(access());
    renderScreen(<AiAssistantsSection />);
    expect(await screen.findByText(`${API}/mcp`)).toBeTruthy();
    expect(screen.queryByText("Create token")).toBeNull();
    expect(screen.queryByText("Tokens")).toBeNull();
  });
});
