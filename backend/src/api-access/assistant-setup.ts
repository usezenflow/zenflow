import type { AssistantSetupGuide } from "@zenflow/shared";

/**
 * Connection steps per assistant, one tab each, each with a link to the exact
 * settings page. Assistants sign in with the user's Zenflow account, so
 * nothing is copied but the address. Vietnamese, for non-technical users.
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
        "Mở Connectors, bật Developer mode trong Advanced (chế độ cho nhà phát triển).",
        "Chọn Create, đặt tên Zenflow, dán địa chỉ kết nối ở trên và chọn đăng nhập OAuth.",
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
        "Mở Connected apps. Dưới Custom apps, dán địa chỉ kết nối ở trên rồi chọn Next.",
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
        "Đặt tên Zenflow, dán địa chỉ kết nối ở trên rồi chọn Continue.",
        "Giữ cài đặt mặc định và chọn Add.",
        "Bấm Connect, đăng nhập Zenflow rồi chọn Cho phép.",
        "Trong cuộc trò chuyện mới, bật Zenflow ở menu +.",
      ],
    },
    {
      id: "other",
      label: "Khác",
      steps: ["Với Claude Code, chạy lệnh dưới đây rồi gõ /mcp để đăng nhập."],
      code: `claude mcp add --transport http zenflow ${mcpUrl}`,
    },
  ];
}
