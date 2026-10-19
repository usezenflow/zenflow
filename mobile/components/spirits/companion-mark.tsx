import { Logo } from "@/components/logo";
import { SpiritArt } from "@/components/spirits/spirit-art";
import { useSpiritsStore } from "@/hooks/use-spirits";
import { equippedSpiritId } from "@/lib/spirit-collection";
import { useEffect } from "react";

/**
 * The mark on empty lists: the student's companion spirit once they own one,
 * otherwise the logo.
 */
export function CompanionMark({ size = 56 }: { size?: number }) {
  const data = useSpiritsStore((s) => s.data);
  const load = useSpiritsStore((s) => s.load);
  useEffect(() => {
    if (!data) void load();
  }, [data, load]);

  const companion = data ? equippedSpiritId(data.collection) : null;
  if (!companion) return <Logo className="h-14 w-14" />;
  return <SpiritArt id={companion} size={size} />;
}
