import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useMemo } from "react";
import { noteExtensions } from "@/components/common/editor/note-extensions";
import { resolveNoteFileUrls } from "@/lib/notes/media";
import { cn } from "@/lib/utils";
import { sanitizeContent } from "@/utils/sanitizer";
import "./note-cards.css";

/**
 * A session's note, read-only. Renders the note HTML through the same TipTap
 * extensions as the editor, so media, cards and checklists match.
 */
export function NoteView({ html, className }: { html: string; className?: string }) {
  const content = useMemo(
    () => sanitizeContent(resolveNoteFileUrls(html, import.meta.env.VITE_API_URL)),
    [html],
  );
  const editor = useEditor(
    {
      extensions: noteExtensions({ readOnly: true }),
      editable: false,
      shouldRerenderOnTransaction: false,
      editorProps: {
        attributes: { class: "markdown note-view-body focus:outline-none" },
      },
    },
    [],
  );

  useEffect(() => {
    editor?.commands.setContent(content, { emitUpdate: false });
  }, [editor, content]);

  return (
    <div className={cn("note-view", className)}>
      <EditorContent editor={editor} />
    </div>
  );
}
