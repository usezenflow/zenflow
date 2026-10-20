import { NoteEditor } from "@/components/tasks/note-editor";
import { NoteView } from "@/components/notes/note-view";
import { NoteTemplates } from "@/components/calendar/note-templates";
import { Button } from "@/components/ui/button";
import { t, useLanguage } from "@/lib/i18n";
import { isNoteEmpty } from "@/lib/notes/note-html";
import type { RefObject } from "react";
import { useState } from "react";

/**
 * The session's note. A filled note reads as a view (link cards, media) until
 * Edit opens the editor. An empty note opens the editor with templates above it.
 */
export function SessionNoteField({
  initial,
  value,
  onChange,
  onCommit,
  newUploadsRef,
  disabled,
}: {
  /** The note as saved when the field mounts; it seeds the editor. */
  initial: string;
  value: string;
  onChange: (html: string) => void;
  /** Saves now, e.g. when the user leaves edit mode. */
  onCommit: () => void;
  newUploadsRef?: RefObject<string[]>;
  disabled?: boolean;
}) {
  useLanguage();
  const [editing, setEditing] = useState(() => isNoteEmpty(initial));
  const [seed, setSeed] = useState(initial);
  const empty = isNoteEmpty(value);

  function startEditing() {
    setSeed(value);
    setEditing(true);
  }

  function stopEditing() {
    setEditing(false);
    onCommit();
  }

  function fillTemplate(html: string) {
    setSeed(html);
    onChange(html);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">{t("Note")}</span>
        {!empty && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={editing ? stopEditing : startEditing}
          >
            {editing ? t("Done") : t("Edit")}
          </Button>
        )}
      </div>
      {editing ? (
        <>
          {empty && <NoteTemplates onPick={fillTemplate} />}
          <NoteEditor
            initialValue={seed}
            value={value}
            onChange={onChange}
            newUploadsRef={newUploadsRef}
            disabled={disabled}
          />
        </>
      ) : (
        <NoteView html={value} />
      )}
    </div>
  );
}
