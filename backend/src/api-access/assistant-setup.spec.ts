import { buildAssistantSetup } from "./assistant-setup";

const MCP_URL = "https://zenflow.test/api/v1/mcp";

describe("buildAssistantSetup", () => {
  const guides = buildAssistantSetup({ mcpUrl: MCP_URL });

  it("puts ChatGPT and Gemini first, each with steps", () => {
    expect(guides.map((g) => g.label)).toEqual([
      "ChatGPT",
      "Gemini",
      "Claude",
      "Khác",
    ]);
    for (const guide of guides) expect(guide.steps.length).toBeGreaterThan(0);
  });

  it("links each assistant to its own settings page", () => {
    const links = Object.fromEntries(guides.map((g) => [g.id, g.link?.url]));
    expect(links).toEqual({
      chatgpt: "https://chatgpt.com/#settings/Connectors",
      gemini: "https://gemini.google.com/apps",
      claude: "https://claude.ai/customize/connectors",
      other: undefined,
    });
  });

  it("asks for no token on the assistants that sign in with OAuth", () => {
    for (const id of ["chatgpt", "gemini", "claude"]) {
      const guide = guides.find((g) => g.id === id)!;
      expect(guide.steps.join(" ")).not.toMatch(/token|zf_/i);
      expect(guide.code).toBeUndefined();
    }
  });

  it("warns Gemini and ChatGPT users about who can connect", () => {
    expect(guides.find((g) => g.id === "gemini")!.steps[0]).toMatch(/Mỹ/);
    expect(guides.find((g) => g.id === "chatgpt")!.steps[0]).toMatch(/Free/);
  });

  it("puts the MCP URL in the Claude Code command and the token example", () => {
    const code = guides.find((g) => g.id === "other")?.code ?? "";
    expect(code).toContain(
      `claude mcp add --transport http zenflow ${MCP_URL}`,
    );
    expect(code).toContain(`curl ${MCP_URL}`);
  });
});
