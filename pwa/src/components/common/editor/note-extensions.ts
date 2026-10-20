import Highlight from "@tiptap/extension-highlight";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import "@/components/notes/note-cards.css";
import { NoteParagraphView } from "@/components/notes/note-paragraph";
import { Audio } from "./audio-block";
import { CustomLink } from "./custom-link";
import { ImageBlock } from "./image-block";
import { Video } from "./video-block";

/**
 * Paragraph that renders link-only lines as cards. Used read-only only; the editor keeps plain text.
 * Priority keeps it first in the schema: ProseMirror fills an empty `block+` with the first block
 * type, and any other one (lists, quotes) recurses until the stack overflows.
 */
const CardParagraph = Node.create({
  name: "paragraph",
  priority: 1001,
  group: "block",
  content: "inline*",

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["p", mergeAttributes(HTMLAttributes), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(NoteParagraphView);
  },
});

/** The note's TipTap schema: the editor and the read-only note share it. */
export function noteExtensions({ readOnly }: { readOnly: boolean }) {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: false,
      underline: false,
      ...(readOnly ? { paragraph: false } : {}),
    }),
    ...(readOnly ? [CardParagraph] : []),
    readOnly ? CustomLink.configure({ openOnClick: false }) : CustomLink,
    ImageBlock,
    Highlight,
    Underline,
    Video,
    Audio,
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}
