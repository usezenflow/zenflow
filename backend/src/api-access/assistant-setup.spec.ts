import { buildAssistantSetup } from "./assistant-setup";

const MCP_URL = "https://zenflow.test/api/v1/mcp";

describe("buildAssistantSetup", () => {
  const guides = buildAssistantSetup({ mcpUrl: MCP_URL });

  it("gives each assistant its own tab with steps", () => {
    expect(guides.map((g) => g.label)).toEqual(["ChatGPT", "Claude", "Gemini", "Khác"]);
    for (const guide of guides) expect(guide.steps.length).toBeGreaterThan(0);
  });

  it("puts the MCP URL in the Gemini config", () => {
    const gemini = guides.find((g) => g.id === "gemini");
    expect(JSON.parse(gemini?.code ?? "{}")).toEqual({
      mcpServers: {
        zenflow: {
          httpUrl: MCP_URL,
          headers: { Authorization: "Bearer zf_..." },
        },
      },
    });
  });

  it("puts the MCP URL in the Claude Code command", () => {
    const other = guides.find((g) => g.id === "other");
    expect(other?.code).toContain(`claude mcp add --transport http zenflow ${MCP_URL}`);
  });
});
