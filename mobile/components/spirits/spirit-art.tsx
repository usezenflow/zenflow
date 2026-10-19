import {
  renderSpirit,
  type Mood,
  type SpiritId,
  type Stage,
} from "@zenflow/spirits";
import { useMemo } from "react";
import { SvgXml } from "react-native-svg";
import { useColorScheme } from "@/lib/useColorScheme";

type SpiritArtProps = {
  id: SpiritId;
  stage?: Stage;
  mood?: Mood;
  size: number;
};

/** A spirit from the shared art library. Static: motion is not drawn yet. */
export function SpiritArt({
  id,
  stage = "ascended",
  mood = "calm",
  size,
}: SpiritArtProps) {
  const { isDarkColorScheme } = useColorScheme();
  const xml = useMemo(
    () => renderSpirit(id, stage, mood, { dark: isDarkColorScheme }),
    [id, stage, mood, isDarkColorScheme],
  );
  return <SvgXml xml={xml} width={size} height={size} />;
}
