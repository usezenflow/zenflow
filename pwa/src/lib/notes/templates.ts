import { t } from "@/lib/i18n";

export interface NoteTemplateSection {
  title: string;
  /** Sample lines, replaced as the user types. */
  items: string[];
  checklist?: boolean;
}

export interface NoteTemplate {
  key: string;
  title: string;
  hint: string;
  sections: NoteTemplateSection[];
}

/** Starter notes offered while a note is empty. Same copy as mobile. */
export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    key: "study",
    title: "Study notes",
    hint: "Key ideas, questions, summary",
    sections: [
      {
        title: "Key ideas",
        items: ["The main concept in one line", "An example that makes it click"],
      },
      { title: "Questions", items: ["What is still unclear?"] },
      { title: "Summary", items: ["Three sentences in your own words"] },
    ],
  },
  {
    key: "checklist",
    title: "Checklist",
    hint: "A simple to-do list",
    sections: [
      {
        title: "To do",
        items: ["Read the chapter", "Solve the practice problems", "Review mistakes"],
        checklist: true,
      },
    ],
  },
  {
    key: "exam",
    title: "Exam prep",
    hint: "Topics, practice, formulas",
    sections: [
      {
        title: "Topics to review",
        items: ["Chapter 1 summary", "Lecture slides", "Weak areas"],
        checklist: true,
      },
      { title: "Practice", items: ["Past paper, timed"] },
      { title: "Remember", items: ["A formula or date to memorize"] },
    ],
  },
  {
    key: "assignment",
    title: "Assignment brief",
    hint: "Goal, requirements, resources",
    sections: [
      { title: "Goal", items: ["What this assignment should achieve"] },
      {
        title: "Requirements",
        items: ["Word count or length", "Format and citations", "Submit by the deadline"],
        checklist: true,
      },
      { title: "Resources", items: ["Textbook pages or links"] },
    ],
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The template as note HTML: a bold heading per section over its lines or checklist items. */
export function templateHtml(template: NoteTemplate): string {
  return template.sections
    .map((section) => {
      const head = `<p><strong>${escapeHtml(t(section.title))}</strong></p>`;
      if (section.checklist) {
        const rows = section.items
          .map(
            (item) =>
              `<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>${escapeHtml(t(item))}</p></div></li>`,
          )
          .join("");
        return `${head}<ul data-type="taskList">${rows}</ul>`;
      }
      const rows = section.items.map((item) => `<li><p>${escapeHtml(t(item))}</p></li>`).join("");
      return `${head}<ul>${rows}</ul>`;
    })
    .join("");
}
