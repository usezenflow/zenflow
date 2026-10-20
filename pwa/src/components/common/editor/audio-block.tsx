import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { AudioPlayer } from "@/components/notes/audio-player";

function AudioBlockView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <AudioPlayer src={String(node.attrs.src ?? "")} />
    </NodeViewWrapper>
  );
}

export const Audio = Node.create({
  name: "audio",
  inline: false,
  group: "block",
  draggable: true,

  addAttributes() {
    return {
      src: {
        default: null,
      },
      controls: {
        default: true,
      },
      style: {
        default: "max-width: 100%;",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: "audio",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["audio", HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(AudioBlockView);
  },
});
