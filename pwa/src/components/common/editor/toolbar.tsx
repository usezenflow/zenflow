import { Editor } from "@tiptap/react";
import {
  Bold,
  Highlighter,
  Italic,
  ListChecks,
  ListIcon,
  ListOrderedIcon,
  MessageSquareQuoteIcon,
  UnderlineIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Toggle } from "@/components/ui/toggle";
import { LinkInsert } from "./link-insert";
import { FileUpload } from "./file-upload";
import { t } from "@/lib/i18n";

interface ToolbarProps {
  editor: Editor;
  newUploadsRef?: React.RefObject<string[]>;
}

export const Toolbar = ({ editor, newUploadsRef }: ToolbarProps) => {
  const [, setState] = useState(0);

  const renderDocs = (editor: Editor) => {
    const { from, to } = editor.state.selection;
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.type.name === "customLink") {
        const href = node.attrs.href;
        // @ts-expect-error: fetchFileMetadata is added by CustomLink, not typed by TipTap
        editor.commands.fetchFileMetadata(href);
      }
    });
  };

  useEffect(() => {
    if (!editor) return;

    editor.on("transaction", ({ editor }) => {
      setState((x) => x + 1);
      renderDocs(editor);
    });

    return () => {
      editor.off("transaction", ({ editor }) => {
        setState((x) => x + 1);
        renderDocs(editor);
      });
    };
  }, [editor]);

  const marks = useMemo(() => {
    return [
      {
        name: "bold",
        label: "Bold",
        icon: Bold,
        onPress: () => editor.chain().focus().toggleBold().run(),
      },
      {
        name: "italic",
        label: "Italic",
        icon: Italic,
        onPress: () => editor.chain().focus().toggleItalic().run(),
      },
      {
        name: "underline",
        label: "Underline",
        icon: UnderlineIcon,
        onPress: () => editor.chain().focus().toggleUnderline().run(),
      },
      {
        name: "highlight",
        label: "Highlight",
        icon: Highlighter,
        onPress: () => editor.chain().focus().toggleHighlight().run(),
      },
      {
        name: "blockquote",
        label: "Quote",
        icon: MessageSquareQuoteIcon,
        onPress: () => editor.chain().focus().toggleBlockquote().run(),
      },
    ] as const;
  }, [editor]);

  const nodes = useMemo(
    () => [
      {
        name: "Bullets",
        label: "Bulleted list",
        mode: "bullet-list",
        icon: ListIcon,
        onPress: () => editor.chain().focus().toggleBulletList().run(),
      },
      {
        name: "Numbering",
        label: "Numbered list",
        mode: "ordered-list",
        icon: ListOrderedIcon,
        onPress: () => editor.chain().focus().toggleOrderedList().run(),
      },
      {
        name: "Checklist",
        label: "Checklist",
        mode: "taskList",
        icon: ListChecks,
        onPress: () => editor.chain().focus().toggleTaskList().run(),
      },
    ],
    [editor],
  );

  return (
    <div className="flex px-2 py-1 items-center flex-wrap gap-x-2">
      {marks.map((mark) => (
        <Toggle
          key={mark.name}
          size="sm"
          aria-label={t(mark.label)}
          title={t(mark.label)}
          pressed={editor.isActive(mark.name)}
          onPressedChange={() => mark.onPress()}
        >
          <mark.icon className="w-4 h-4" />
        </Toggle>
      ))}
      <LinkInsert editor={editor} />
      <FileUpload
        value={editor.getHTML()}
        onChange={(value) => editor.commands.setContent(value)}
        newUploadsRef={newUploadsRef}
      />
      <div className="flex gap-x-2 items-center">
        {nodes.map((node) => (
          <Toggle
            key={node.name}
            size="sm"
            aria-label={t(node.label)}
            title={t(node.label)}
            pressed={editor.isActive(node.mode)}
            onPressedChange={() => node.onPress()}
          >
            <node.icon className="w-4 h-4" />
          </Toggle>
        ))}
      </div>
    </div>
  );
};
