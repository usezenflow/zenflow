/** One MCP tool as the assistant sees it. Names are snake_case; descriptions are Vietnamese and name every argument. */
export interface McpToolInfo {
  name: string;
  description: string;
}

/**
 * Every tool the MCP endpoint serves. The prompt lists these, so a tool
 * appears there only once it is registered.
 */
export const MCP_TOOLS: readonly McpToolInfo[] = [
  {
    name: "list_schedule",
    description:
      "Liệt kê các phiên trong ngày, tuần hoặc tháng quanh một ngày. view là day, week hoặc month. date là ngày dạng YYYY-MM-DD theo múi giờ của người dùng.",
  },
  {
    name: "get_session",
    description: "Lấy một phiên theo id. Lấy id từ kết quả của list_schedule.",
  },
  {
    name: "create_tasks",
    description:
      "Tạo tối đa 20 phiên trong items, theo thứ tự. Mỗi phiên có type, title (tối đa 60 ký tự) và durationMinutes (bội số của 15). type là TASK cho việc có hạn chót: đặt deadline (ISO-8601). type là ASSIGNMENT, EXAM, LECTURE hoặc DND cho lịch cố định: đặt scheduledStartTime (ISO-8601). Đặt dryRun là true để xem giờ dự kiến (proposedStart) mà không ghi gì.",
  },
];
