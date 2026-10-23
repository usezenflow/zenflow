import type { McpToolInfo } from "./mcp/mcp-tool-catalog";

/**
 * The system prompt for an assistant connected over MCP: which tools exist, the
 * user's timezone, and the rules for using them. Vietnamese, to match the
 * user's language; tool and argument names stay in English.
 */
export function buildApiAccessPrompt(args: {
  timezone: string;
  tools: readonly McpToolInfo[];
}): string {
  const tools = args.tools.map((t) => `- ${t.name}: ${t.description}`);
  return [
    `Bạn quản lý lịch Zenflow của người dùng bằng các công cụ bên dưới. Múi giờ của người dùng là ${args.timezone}. Mọi thời gian gửi đi và nhận về đều theo múi giờ này, kèm độ lệch (ví dụ +07:00).`,
    "",
    "Công cụ:",
    ...tools,
    "",
    "Quy tắc:",
    "- Đọc lịch bằng list_schedule trước khi tạo, dời hoặc sửa bất kỳ phiên nào.",
    "- Với create_tasks, luôn gọi với dryRun là true trước. Đưa giờ dự kiến cho người dùng xem. Chỉ gọi lại không có dryRun khi người dùng đồng ý.",
    "- Nếu một mục trả về ERROR, sửa theo thông báo lỗi rồi gửi lại mục đó. Các mục khác vẫn được tạo.",
    "- Không tự bịa hạn chót. Hỏi người dùng khi thiếu deadline.",
    "- Trả lời ngắn gọn. Mỗi phiên ghi rõ tên và giờ bắt đầu.",
  ].join("\n");
}
