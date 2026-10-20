import Image from "@tiptap/extension-image";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { ImageView } from "@/components/notes/image-view";

function ImageBlockView({ node }: NodeViewProps) {
  return (
    <NodeViewWrapper>
      <ImageView
        src={String(node.attrs.src ?? "")}
        alt={String(node.attrs.alt ?? "")}
      />
    </NodeViewWrapper>
  );
}

/** The TipTap image with a zoomable, retrying view. */
export const ImageBlock = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockView);
  },
});
