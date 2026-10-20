import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AudioPlayer } from "@/components/notes/audio-player";
import { DocCard } from "@/components/notes/doc-card";
import { ImageView } from "@/components/notes/image-view";
import { LinkCard } from "@/components/notes/link-card";
import { VideoPlayer } from "@/components/notes/video-player";
import { isFileHref, mediaKind } from "@/lib/notes/media";

/** A paragraph that is one link, read-only: a player, a file card or a link card. */
function linkOnly(node: NodeViewProps["node"]): { href: string; text: string } | null {
  if (node.childCount !== 1) return null;
  const child = node.firstChild;
  if (!child?.isText) return null;
  const link = child.marks.find((mark) => mark.type.name === "link");
  if (!link) return null;
  return { href: String(link.attrs.href ?? ""), text: child.text ?? "" };
}

function cardFor(href: string, text: string) {
  if (isFileHref(href)) {
    switch (mediaKind(text)) {
      case "audio":
        return <AudioPlayer src={href} />;
      case "video":
        return <VideoPlayer src={href} />;
      case "image":
        return <ImageView src={href} alt={text} />;
      default:
        return <DocCard href={href} name={text} />;
    }
  }
  if (/^https?:\/\//i.test(href)) return <LinkCard href={href} text={text} />;
  return null;
}

/**
 * Read-only paragraph. A link-only line becomes its card; the text stays in the
 * (hidden) content node so the document keeps its shape.
 */
export function NoteParagraphView({ node }: NodeViewProps) {
  const link = linkOnly(node);
  const card = link ? cardFor(link.href, link.text) : null;
  return (
    <NodeViewWrapper>
      {card}
      <NodeViewContent<"p">
        as="p"
        className={card ? "hidden" : undefined}
      />
    </NodeViewWrapper>
  );
}
