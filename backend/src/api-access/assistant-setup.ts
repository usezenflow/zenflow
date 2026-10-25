import type { AssistantSetupGuide } from "@zenflow/shared";

const TOKEN = "zf_..."; // Placeholder: the real secret is shown once when the token is created.

/**
 * Connection steps per assistant, one tab each, each with a link to the exact
 * settings page. Assistants sign in through OAuth, so no token is pasted.
 * Vietnamese, like the prompt.
 */
export function buildAssistantSetup(args: {
  mcpUrl: string;
}): AssistantSetupGuide[] {
  const { mcpUrl } = args;
  return [
    {
      id: "chatgpt",
      label: "ChatGPT",
      link: {
        label: "Mở Connectors của ChatGPT",
        url: "https://chatgpt.com/#settings/Connectors",
      },
      steps: [
        "Gói Free chỉ dùng được app có trong thư viện Apps của ChatGPT. Zenflow chưa có ở đó, hãy dùng gói Plus trở lên.",
        "Mở Connectors, bật Developer mode trong Advanced.",
        "Chọn Create, đặt tên Zenflow, dán MCP server URL ở trên và chọn OAuth.",
        "Bấm Connect, đăng nhập Zenflow rồi chọn Cho phép.",
        "Trong cuộc trò chuyện mới, chọn Zenflow ở menu +.",
      ],
    },
    {
      id: "gemini",
      label: "Gemini",
      link: {
        label: "Mở Connected apps của Gemini",
        url: "https://gemini.google.com/apps",
      },
      steps: [
        "Dùng gemini.google.com trên máy tính. Gemini chỉ mở tính năng này cho tài khoản Google cá nhân từ 18 tuổi, ở Mỹ, tiếng Anh, và bật Keep Activity.",
        "Mở Connected apps. Dưới Custom apps, dán MCP server URL ở trên rồi chọn Next.",
        "Đăng nhập Zenflow rồi chọn Cho phép.",
        "Trong cuộc trò chuyện, gõ @ rồi chọn Zenflow.",
      ],
    },
    {
      id: "claude",
      label: "Claude",
      link: {
        label: "Mở Connectors của Claude",
        url: "https://claude.ai/customize/connectors",
      },
      steps: [
        "Mở Connectors, chọn + Add rồi Add custom connector.",
        "Đặt tên Zenflow, dán MCP server URL ở trên rồi chọn Continue.",
        "Giữ cài đặt mặc định và chọn Add.",
        "Bấm Connect, đăng nhập Zenflow rồi chọn Cho phép.",
        "Trong cuộc trò chuyện mới, bật Zenflow ở menu +.",
      ],
    },
    {
      id: "other",
      label: "Khác",
      steps: [
        "Với Claude Code, chạy lệnh dưới đây rồi gõ /mcp để đăng nhập.",
        "Với script hoặc client không có OAuth, tạo token ở mục Token bên dưới và gửi header Authorization: Bearer như trong lệnh thứ hai.",
      ],
      code: [
        `claude mcp add --transport http zenflow ${mcpUrl}`,
        `curl ${mcpUrl} -H "Authorization: Bearer ${TOKEN}"`,
      ].join("\n"),
    },
  ];
}
