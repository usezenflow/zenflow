import type { AssistantSetupGuide } from "@zenflow/shared";

const TOKEN = "zf_..."; // Placeholder: the real secret is shown once when the token is created.

/**
 * Connection steps per assistant, one tab each. Each client has its own menu
 * names, so the steps name the exact screens. Vietnamese, like the prompt.
 */
export function buildAssistantSetup(args: {
  mcpUrl: string;
}): AssistantSetupGuide[] {
  const { mcpUrl } = args;
  const header = `Authorization: Bearer ${TOKEN}`;
  return [
    {
      id: "chatgpt",
      label: "ChatGPT",
      steps: [
        "Tạo token ở mục Token bên dưới và sao chép ngay. Token chỉ hiện một lần.",
        "Mở ChatGPT, vào Settings, chọn Connectors, rồi bật Developer mode trong Advanced.",
        "Chọn Add custom MCP server, đặt tên là Zenflow, rồi dán MCP server URL ở trên.",
        `Nếu có ô nhập header, thêm ${header}. Nếu không có, kết nối này chưa dùng được.`,
        "Mở cuộc trò chuyện mới và dán system prompt ở trên làm hướng dẫn.",
      ],
    },
    {
      id: "claude",
      label: "Claude",
      steps: [
        "Tạo token ở mục Token bên dưới và sao chép ngay. Token chỉ hiện một lần.",
        "Trên claude.ai, mở Customize, chọn Connectors. Nếu dùng gói nhóm, vào Organization settings rồi chọn Connectors.",
        "Chọn +, Add custom connector, đặt tên là Zenflow, rồi dán MCP server URL ở trên.",
        `Chọn No sign-in và nhập ${header} vào ô header.`,
        "Mở cuộc trò chuyện mới, bật Zenflow trong danh sách công cụ, và dán system prompt ở trên làm hướng dẫn.",
      ],
    },
    {
      id: "gemini",
      label: "Gemini",
      steps: [
        "Tạo token ở mục Token bên dưới và sao chép ngay. Token chỉ hiện một lần.",
        "Gemini CLI kết nối MCP qua file ~/.gemini/settings.json. Tạo file nếu chưa có.",
        "Thêm khối dưới đây vào mcpServers, thay zf_... bằng token của bạn.",
        "Chạy gemini rồi gõ /mcp để kiểm tra Zenflow đã kết nối.",
      ],
      code: JSON.stringify(
        {
          mcpServers: {
            zenflow: {
              httpUrl: mcpUrl,
              headers: { Authorization: `Bearer ${TOKEN}` },
            },
          },
        },
        null,
        2,
      ),
    },
    {
      id: "other",
      label: "Khác",
      steps: [
        "Với Claude Code, chạy lệnh dưới đây trong terminal, thay zf_... bằng token của bạn.",
        "Với client khác, chọn Streamable HTTP, nhập MCP server URL và thêm header Authorization như trên.",
        "Client không hỗ trợ MCP thì dùng REST base URL và gửi cùng header Authorization.",
      ],
      code: `claude mcp add --transport http zenflow ${mcpUrl} --header "Authorization: Bearer ${TOKEN}"`,
    },
  ];
}
