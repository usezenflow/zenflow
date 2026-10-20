import { CheckSquare, ClipboardList, GraduationCap, Notebook, type LucideIcon } from "lucide-react";
import { useLanguage, t } from "@/lib/i18n";
import { NOTE_TEMPLATES, templateHtml } from "@/lib/notes/templates";

const ICONS: Record<string, LucideIcon> = {
  study: Notebook,
  checklist: CheckSquare,
  exam: GraduationCap,
  assignment: ClipboardList,
};

/** Starter chips under an empty note. A tap fills the note with the template's HTML. */
export function NoteTemplates({ onPick }: { onPick: (html: string) => void }) {
  useLanguage();
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-semibold text-muted-foreground">
        {t("Start with a template")}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {NOTE_TEMPLATES.map((template) => {
          const Icon = ICONS[template.key] ?? Notebook;
          return (
            <button
              key={template.key}
              type="button"
              title={t(template.hint)}
              onClick={() => onPick(templateHtml(template))}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-card-foreground transition-colors hover:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none"
            >
              <Icon className="size-3.5 text-muted-foreground" aria-hidden />
              {t(template.title)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
