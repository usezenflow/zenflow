/** One MCP tool as the assistant sees it. Names are snake_case; descriptions are Vietnamese and name every argument. */
export interface McpToolInfo {
  name: string;
  description: string;
}

/**
 * Every tool the MCP endpoint serves, with the description the assistant reads.
 */
export const MCP_TOOLS: readonly McpToolInfo[] = [
  {
    name: "get_time",
    description:
      "Giờ hiện tại, hôm nay, ngày mai, đầu và cuối tuần, và bảng 14 ngày tới (ngày và thứ) theo múi giờ của người dùng. Luôn gọi công cụ này thay vì tự tính ngày hoặc thứ. Không có tham số.",
  },
  {
    name: "list_schedule",
    description:
      "Liệt kê các phiên trong khoảng from đến to (YYYY-MM-DD, theo múi giờ của người dùng, tối đa 30 ngày, cả hai đầu đều tính). Có thể lọc theo q (biểu thức chính quy trên tiêu đề, ghi chú, địa điểm), types, minDuration, maxDuration, deadlineFrom, deadlineTo, và sắp xếp theo sort (start, duration, deadline) với order (asc, desc).",
  },
  {
    name: "recap",
    description:
      "Tổng kết lịch từ from đến to (YYYY-MM-DD, tối đa 30 ngày) để vẽ biểu đồ: days (phút theo loại, phút bận, phút trống, khoảng trống dài nhất, giờ bắt đầu đầu tiên và kết thúc cuối cùng mỗi ngày), hourHeat (7 thứ x 24 giờ, phút bận), deadlines (còn dư bao nhiêu phút), totals, gaps (ngày không có giờ nghỉ trưa, buổi tối quá tải, có khối ngủ hay chưa), insights. rhythm chỉ có khi hệ thống đã học được thói quen của người dùng.",
  },
  {
    name: "find_free_slots",
    description:
      "Tìm các khoảng trống từ from đến to (YYYY-MM-DD) dài ít nhất durationMinutes, trong khung 07:00 đến 22:00, sớm nhất trước. Chỉ đọc, không ghi gì. Dùng để gợi ý 2 hoặc 3 giờ cho người dùng chọn.",
  },
  {
    name: "get_session",
    description: "Lấy một phiên theo id. Lấy id từ kết quả của list_schedule.",
  },
  {
    name: "update_session",
    description:
      "Sửa hoặc dời phiên theo id: title, location, durationMinutes, deadline, notBefore (không bắt đầu sớm hơn, ISO-8601), window (MORNING, AFTERNOON hoặc EVENING), scheduledStartTime (ISO-8601). Phiên lặp có scope: occurrence, following hoặc series. Lần gọi đầu (không có planId) chỉ xem trước và trả về planId; khi người dùng đồng ý, gọi lại đúng các tham số đó kèm planId.",
  },
  {
    name: "delete_sessions",
    description:
      "Xóa tối đa 50 mục trong items, mỗi mục có kind và id. kind là session (id phiên hoặc lần lặp), series (id chuỗi lặp, lấy seriesId từ list_schedule) hoặc timetable (id một buổi của môn, scope all xóa cả môn, following xóa từ buổi đó). Lần gọi đầu (không có planId) chỉ xem trước và trả về planId. Chỉ xóa thật khi người dùng đồng ý: gọi lại đúng các tham số đó kèm planId.",
  },
  {
    name: "undo_last_change",
    description: "Hoàn tác thay đổi gần nhất của người dùng. Không có tham số.",
  },
  {
    name: "replan",
    description:
      "Xếp lại toàn bộ các việc (TASK) đã có giờ trong khoảng from đến to (YYYY-MM-DD, tối đa 30 ngày, chỉ từ bây giờ trở đi), việc gấp nhất xếp trước. Lịch cố định và DND giữ nguyên. change: balanced (mặc định, giữ gần giờ cũ nếu được) hoặc free (xếp lại tự do). Lần gọi đầu (không có planId) chỉ trả về moves (từ giờ nào sang giờ nào), unplaced và planId. Khi người dùng đồng ý, gọi lại đúng các tham số đó kèm planId. Hoàn tác bằng undo_last_change.",
  },
  {
    name: "sync_status",
    description: "Trạng thái đồng bộ Google Calendar và lỗi gần nhất.",
  },
  {
    name: "create_tasks",
    description:
      "Tạo tối đa 50 phiên trong items, theo thứ tự. Mỗi phiên có type, title (tối đa 60 ký tự) và durationMinutes (bội số của 15). type là TASK cho việc có hạn chót: đặt deadline (ISO-8601), có thể thêm notBefore (không bắt đầu sớm hơn, ISO-8601) và window (MORNING, AFTERNOON hoặc EVENING) khi việc chỉ làm được vào lúc đó. Việc có giờ cố định (bữa ăn, giờ ngủ, lớp, ca làm, giờ người dùng đã nói) luôn là DND, không phải TASK. type là ASSIGNMENT, EXAM, LECTURE hoặc DND cho lịch cố định: đặt scheduledStartTime (ISO-8601), thêm rrule để lặp (thời khóa biểu, giờ ngủ). Lần gọi đầu (không có planId) chỉ xem trước giờ dự kiến (proposedStart, localStart, warnings nếu giờ lạ, cuối tuần, sát hạn hoặc trùng lịch khác) và trả về planId. Khi người dùng đồng ý, gọi lại đúng các tham số đó kèm planId để tạo thật.",
  },
];
