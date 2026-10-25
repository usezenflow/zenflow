/** Translate only known generated framing; user and upstream titles stay intact. */
export function localizeNotification<
  T extends { eventName: string; title: string; content: string },
>(row: T, lang?: string): T {
  if (lang !== "VI_VN") return row;
  let { title, content } = row;
  if (/^(assignment|exam|lecture)\./.test(row.eventName)) {
    title = title
      .replace(/^New assignment: /, "Bài tập mới: ")
      .replace(/^New exam: /, "Lịch thi mới: ")
      .replace(/^Assignment done: /, "Đã nộp bài: ")
      .replace(/^Updated: /, "Đã cập nhật: ")
      .replace(/^Lectures removed: /, "Đã xóa lịch học: ");
    if (row.eventName.includes(".group_") && !title.startsWith("You have ")) {
      const vn = (noun: string) =>
        noun.startsWith("exam")
          ? "lịch thi"
          : noun.startsWith("assignment")
            ? "bài tập"
            : "buổi học";
      const num = (n: string) => (/^an?$/i.test(n) ? "1" : n);
      title = title
        .replace(
          /(\d+|an?) new (exams?|assignments?|lectures?)/gi,
          (_, n: string, noun: string) => `${num(n)} ${vn(noun)} mới`,
        )
        .replace(
          /(\d+|an?) (exam|assignment|lecture) changes?/gi,
          (_, n: string, noun: string) => `${num(n)} thay đổi về ${vn(noun)}`,
        )
        .replace(
          /(\d+|an?) (exams?|assignments?|lectures?) removed/gi,
          (_, n: string, noun: string) => `${num(n)} ${vn(noun)} đã xóa`,
        )
        .replace(/ on LMS$/, " trên LMS");
    }
    if (title.startsWith("You have ")) {
      title = title
        .slice(9)
        .replace(
          /(\d+|a|an) new (exams?|assignments?|lectures?)/g,
          (_, n: string, noun: string) =>
            `${n === "a" || n === "an" ? "1" : n} ${noun.startsWith("exam") ? "lịch thi" : noun.startsWith("assignment") ? "bài tập" : "buổi học"} mới`,
        )
        .replace(
          /(\d+|a|an) changes? to your (exams|assignments|lectures)/g,
          (_, n: string, noun: string) =>
            `${n === "a" || n === "an" ? "1" : n} thay đổi về ${noun === "exams" ? "lịch thi" : noun === "assignments" ? "bài tập" : "lịch học"}`,
        )
        .replace(
          /(\d+|a|an) (exams?|assignments?|lectures?) removed/g,
          (_, n: string, noun: string) =>
            `${n === "a" || n === "an" ? "1" : n} ${noun.startsWith("exam") ? "lịch thi" : noun.startsWith("assignment") ? "bài tập" : "buổi học"} đã xóa`,
        )
        .replace(/ from the portal$/, " từ cổng sinh viên")
        .replace(/ from LMS$/, " từ LMS");
      title = `Bạn có ${title}`;
    }
    const copy: Record<string, string> = {
      "Checked off from LMS.": "Đã đánh dấu hoàn thành từ LMS.",
      "Plan it before it's due.": "Hãy lên kế hoạch trước hạn nộp.",
      "Plan them before they're due.": "Hãy lên kế hoạch trước hạn nộp.",
      "Plan your revision now.": "Hãy lên lịch ôn tập ngay.",
      "Check your timetable.": "Xem lại thời khóa biểu của bạn.",
      "See what changed.": "Xem có gì thay đổi.",
      "It's gone from your calendar.": "Mục này đã biến mất khỏi lịch của bạn.",
      "They're gone from your calendar.":
        "Các mục này đã biến mất khỏi lịch của bạn.",
      "Synced from DLU. Tap to see it on your calendar.":
        "Đã đồng bộ từ DLU. Nhấn để xem trên lịch của bạn.",
      "Synced from DLU. Tap to see the next one on your calendar.":
        "Đã đồng bộ từ DLU. Nhấn để xem buổi tiếp theo trên lịch của bạn.",
      "Synced from DLU. It's no longer on your calendar.":
        "Đã đồng bộ từ DLU. Mục này đã được xóa khỏi lịch của bạn.",
      "Synced from DLU. They're no longer on your calendar.":
        "Đã đồng bộ từ DLU. Các mục này đã được xóa khỏi lịch của bạn.",
      "Added from your LMS. Plan the work that leads up to it.":
        "Đã thêm từ LMS. Hãy lên kế hoạch hoàn thành bài tập.",
      "Added from your portal. Plan revision sessions before it.":
        "Đã thêm từ cổng sinh viên. Hãy lên lịch ôn tập trước kỳ thi.",
      "The portal moved this class.":
        "Cổng sinh viên đã thay đổi lịch học này.",
      "These classes were taken off your DLU timetable.":
        "Các buổi học này đã được xóa khỏi thời khóa biểu DLU của bạn.",
    };
    content = copy[content] ?? content;
  } else if (row.eventName === "timetable.ready") {
    title = title.replace(
      /^Timetable for semester (\d) (\S+) is available$/,
      (_, term: string, year: string) =>
        `Thời khóa biểu học kỳ ${term} ${year} đã sẵn sàng`,
    );
    title = title.replace(
      /^Sem (\d) timetable is live$/,
      (_, term: string) => `Thời khóa biểu HK${term} đã lên sóng`,
    );
    content = content
      .replace(
        /^You may not see every week yet\. We're still syncing\.$/,
        "Bạn có thể chưa thấy đủ các tuần. Chúng tôi vẫn đang đồng bộ.",
      )
      .replace(
        /^Still syncing, check back soon\.$/,
        "Đang đồng bộ, lát ghé lại nha.",
      );
  } else if (row.eventName === "marks.ready") {
    title = title.replace(/^Your marks are available$/, "Điểm của bạn đã có");
    content = content.replace(/^Open your profile\.$/, "Mở hồ sơ của bạn.");
  } else if (row.eventName === "timetable.changed") {
    title = title
      .replace(/^Your timetable changed$/, "Thời khóa biểu của bạn đã thay đổi")
      .replace(/^A new lecture$/, "Có buổi học mới")
      .replace(/^(\d+) new lectures$/, "$1 buổi học mới");
    content = content
      .replace(/^See what changed\.$/, "Xem có gì thay đổi.")
      .replace(/^Check your timetable\.$/, "Xem lại thời khóa biểu của bạn.");
  } else if (row.eventName === "session_end.ask") {
    content = content.replace(
      /^Did you get it done\?$/,
      "Bạn đã làm xong chưa?",
    );
  } else if (row.eventName.startsWith("sync_conflict.")) {
    const label = (value: string) =>
      value === "your timetable"
        ? "thời khóa biểu"
        : value === "your exam schedule" || value === "your exams"
          ? "lịch thi"
          : value === "LMS deadlines"
            ? "hạn nộp LMS"
            : value;
    title = title.replace(
      /^(\d+) (?:tasks?|plans?) clash(?:es)? with (.+)$/,
      (_, n: string, source: string) =>
        `${n} kế hoạch trùng với ${label(source)}`,
    );
    content = content.replace(/^Reschedule them now\?$/, "Sắp xếp lại ngay?");
    title = title.replace(
      /^Schedule conflicts after syncing (.+)$/,
      (_, source: string) => `Lịch bị trùng sau khi đồng bộ ${label(source)}`,
    );
    content = content.replace(
      /^After syncing with (.+), we detected (.+) with your own (?:tasks|plans)\. Reschedule them all\?$/,
      (_, source: string, count: string) =>
        `Sau khi đồng bộ ${label(source)}, đã phát hiện ${count.replace(/conflicts?/g, "lịch trùng")} với các kế hoạch của bạn. Sắp xếp lại tất cả?`,
    );
  }
  return { ...row, title, content };
}

/** Daily brief counts and the first item of the day (issue #255). */
export interface DailyBriefCopyInput {
  classes: number;
  blocks: number;
  firstTitle: string;
  /** `HH:mm` in the user's timezone. */
  firstTime: string;
}

/** Morning brief push: counts as the title, the first item as the body. */
export function dailyBriefCopy(
  input: DailyBriefCopyInput,
  lang?: string,
): { title: string; body: string } {
  const { classes, blocks, firstTitle, firstTime } = input;
  if (lang === "VI_VN") {
    const parts = [
      classes > 0 ? `${classes} tiết học` : null,
      blocks > 0 ? `${blocks} buổi học tập` : null,
    ].filter(Boolean);
    return {
      title: parts.join(", "),
      body: `Tiếp theo: ${firstTitle} lúc ${firstTime}`,
    };
  }
  const parts = [
    classes > 0 ? `${classes} ${classes === 1 ? "class" : "classes"}` : null,
    blocks > 0
      ? `${blocks} ${blocks === 1 ? "study block" : "study blocks"}`
      : null,
  ].filter(Boolean);
  return {
    title: parts.join(", "),
    body: `First up: ${firstTitle} at ${firstTime}`,
  };
}

/** Evening check-in push: the action buttons carry the choice, so the copy only asks. */
export function dailyCheckinCopy(lang?: string): {
  title: string;
  body: string;
} {
  if (lang === "VI_VN") {
    return {
      title: "Kiểm tra hôm nay",
      body: "Xem lại các buổi hôm nay.",
    };
  }
  return {
    title: "Check in on today",
    body: "Look over today's sessions.",
  };
}
