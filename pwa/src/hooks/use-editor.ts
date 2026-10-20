import { useEditor } from "@tiptap/react";
import { useEffect } from "react";
import { sanitizeContent } from "@/utils/sanitizer";
import { noteExtensions } from "@/components/common/editor/note-extensions";

interface ContentEditor {
  content?: string;
  onChange: (newValue: string) => void;
  editable?: boolean;
}

export const useContentEditor = ({
  content,
  onChange,
  editable,
}: ContentEditor) => {
  const editor = useEditor(
    {
      extensions: noteExtensions({ readOnly: false }),
      editable,
      content,
      editorProps: {
        attributes: {
          class:
            "relative break-words text-sm min-h-64 px-3 py-2 focus:outline-none overflow-hidden rounded-lg markdown",
        },
      },
      onUpdate({ editor }) {
        const newContent = sanitizeContent(editor.getHTML());
        onChange(newContent);
      },
    },
    [],
  );

  useEffect(() => {
    editor?.setEditable(!!editable);
  }, [editor, editable]);

  return editor;
};
