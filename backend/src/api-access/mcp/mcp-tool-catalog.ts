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
      "Liệt kê các phiên trong khoảng from đến to (YYYY-MM-DD, theo múi giờ của người dùng, tối đa 30 ngày, cả hai đầu đều tính). Có thể lọc theo q (biểu thức chính quy trên tiêu đề, ghi chú, địa điểm), types, minDuration, maxDuration, deadlineFrom, deadlineTo, và sắp xếp theo sort (start, duration, deadline) với order (asc, desc).",
  },
  {
    name: "get_session",
    description: "Lấy một phiên theo id. Lấy id từ kết quả của list_schedule.",
  },
  {
    name: "update_session",
    description:
      "Sửa hoặc dời phiên theo id: title, location, durationMinutes, deadline, scheduledStartTime (ISO-8601). Phiên lặp có scope: occurrence, following hoặc series.",
  },
  {
    name: "delete_sessions",
    description:
      "Xóa tối đa 50 mục trong items, mỗi mục có kind và id. kind là session (id phiên hoặc lần lặp), series (id chuỗi lặp, lấy seriesId từ list_schedule) hoặc timetable (id một buổi của môn, scope all xóa cả môn, following xóa từ buổi đó). Gọi dryRun là true trước, chỉ xóa thật khi người dùng đồng ý.",
  },
  {
    name: "undo_last_change",
    description: "Hoàn tác thay đổi gần nhất của người dùng. Không có tham số.",
  },
  {
    name: "sync_status",
    description: "Trạng thái đồng bộ Google Calendar và lỗi gần nhất.",
  },
  {
    name: "create_tasks",
    description:
      "Tạo tối đa 50 phiên trong items, theo thứ tự. Mỗi phiên có type, title (tối đa 60 ký tự) và durationMinutes (bội số của 15). type là TASK cho việc có hạn chót: đặt deadline (ISO-8601). type là ASSIGNMENT, EXAM, LECTURE hoặc DND cho lịch cố định: đặt scheduledStartTime (ISO-8601), thêm rrule để lặp (thời khóa biểu, giờ ngủ). Đặt dryRun là true để xem giờ dự kiến (proposedStart) mà không ghi gì.",
  },
];
