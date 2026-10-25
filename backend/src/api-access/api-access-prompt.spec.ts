import { buildApiAccessPrompt } from "./api-access-prompt";
import { MCP_TOOLS } from "./mcp/mcp-tool-catalog";

const TOOLS = [
  {
    name: "list_schedule",
    description: "Liệt kê các phiên trong một khoảng ngày.",
  },
  { name: "create_tasks", description: "Tạo tối đa 20 phiên." },
];

describe("buildApiAccessPrompt", () => {
  it("names the user's timezone and every registered tool", () => {
    const prompt = buildApiAccessPrompt({
      timezone: "Asia/Ho_Chi_Minh",
      tools: TOOLS,
    });
    expect(prompt).toContain("Asia/Ho_Chi_Minh");
    expect(prompt).toContain(
      "- list_schedule: Liệt kê các phiên trong một khoảng ngày.",
    );
    expect(prompt).toContain("- create_tasks: Tạo tối đa 20 phiên.");
  });

  it("states the rules in Vietnamese", () => {
    const prompt = buildApiAccessPrompt({ timezone: "UTC", tools: TOOLS });
    expect(prompt).toContain(
      "Đọc lịch bằng list_schedule trước khi tạo, dời hoặc sửa bất kỳ phiên nào.",
    );
    expect(prompt).toContain("gọi với dryRun là true trước");
    expect(prompt).toContain("Không tự bịa hạn chót.");
    expect(prompt).toContain("Trả lời ngắn gọn.");
  });

  it("stays under 2,200 characters with the real tool list", () => {
    expect(
      buildApiAccessPrompt({ timezone: "Asia/Ho_Chi_Minh", tools: MCP_TOOLS })
        .length,
    ).toBeLessThan(2200);
  });

  it("builds without tools", () => {
    const prompt = buildApiAccessPrompt({ timezone: "UTC", tools: [] });
    expect(prompt).toContain("Công cụ:\n\nQuy tắc:");
  });
});
