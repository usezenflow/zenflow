import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { AssistantConnect } from "@/components/settings/assistant-connect";
import { API } from "@/test/msw/handlers";
import { server } from "@/test/msw/server";
import { renderScreen } from "@/test/utils/render";

const asks = http.get(`${API}/oauth/consent`, ({ request }) => {
  const code = new URL(request.url).searchParams.get("code");
  return code === "ABCD2345"
    ? HttpResponse.json({ data: { clientName: "ChatGPT", redirectHost: "chatgpt.com", scopes: ["schedule"] } })
    : HttpResponse.json({ message: "Check the code and try again." }, { status: 400 });
});

async function enter(code: string) {
  fireEvent.click(screen.getByTestId("assistants.connect"));
  fireEvent.change(await screen.findByPlaceholderText("ABCD2345"), { target: { value: code } });
  fireEvent.click(screen.getByTestId("assistants.look"));
}

describe("AssistantConnect", () => {
  it("shows who is asking, then allows it", async () => {
    let body: unknown;
    server.use(
      asks,
      http.post(`${API}/oauth/consent`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { approved: true } });
      }),
    );
    renderScreen(<AssistantConnect />);

    await enter("abcd 2345");
    expect(await screen.findByText("Allow ChatGPT?")).toBeTruthy();
    expect(screen.getByText("You will be sent back to chatgpt.com.")).toBeTruthy();
    fireEvent.click(screen.getByTestId("assistants.allow"));

    expect(await screen.findByText("Return to your assistant.")).toBeTruthy();
    expect(body).toEqual({ code: "ABCD2345", approve: true });
  });

  it("refuses without connecting", async () => {
    let body: unknown;
    server.use(
      asks,
      http.post(`${API}/oauth/consent`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ data: { approved: false } });
      }),
    );
    renderScreen(<AssistantConnect />);

    await enter("ABCD2345");
    fireEvent.click(await screen.findByTestId("assistants.deny"));

    expect(await screen.findByText("Cancelled")).toBeTruthy();
    expect(body).toEqual({ code: "ABCD2345", approve: false });
  });

  it("explains a wrong code and lets the user retry", async () => {
    server.use(asks);
    renderScreen(<AssistantConnect />);

    await enter("ZZZZ2222");

    expect(await screen.findByText("Check the code and try again.")).toBeTruthy();
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByPlaceholderText("ABCD2345")).toBeTruthy();
  });

  it("opens with the code from the link", async () => {
    server.use(asks);
    renderScreen(<AssistantConnect initialCode="ABCD2345" />);

    const input = (await screen.findByPlaceholderText("ABCD2345")) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("ABCD2345"));
  });

  it("lists connected assistants and disconnects one", async () => {
    server.use(
      http.get(`${API}/oauth/apps`, () =>
        HttpResponse.json({ data: { apps: [{ clientId: "c1", name: "Claude", connectedAt: "2026-10-01T00:00:00.000Z" }] } }),
      ),
      http.delete(`${API}/oauth/apps/c1`, () => HttpResponse.json({ data: { apps: [] } })),
    );
    renderScreen(<AssistantConnect />);

    expect(await screen.findByText("Claude")).toBeTruthy();
    fireEvent.click(screen.getByTestId("assistants.disconnect.c1"));

    await waitFor(() => expect(screen.queryByText("Claude")).toBeNull());
  });
});
