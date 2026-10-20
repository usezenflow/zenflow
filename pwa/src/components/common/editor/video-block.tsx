import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { VideoPlayer } from "@/components/notes/video-player";

function VideoBlockView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <VideoPlayer src={String(node.attrs.src ?? "")} />
    </NodeViewWrapper>
  );
}

export const Video = Node.create({
  name: "video",

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
        tag: "video",
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ["video", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(VideoBlockView);
  },
});
