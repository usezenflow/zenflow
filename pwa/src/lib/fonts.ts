import geistBold from "@zenflow/brand/fonts/Geist-Bold.ttf?url";
import geistExtraBold from "@zenflow/brand/fonts/Geist-ExtraBold.ttf?url";
import geistMedium from "@zenflow/brand/fonts/Geist-Medium.ttf?url";
import geistRegular from "@zenflow/brand/fonts/Geist-Regular.ttf?url";
import geistSemiBold from "@zenflow/brand/fonts/Geist-SemiBold.ttf?url";

/**
 * Geist from `packages/brand`, the same files mobile loads. Vietnamese
 * letters are in the files, so no subset is needed. Geist Mono is not used.
 */
const FACES: [string, string, string][] = [
  [geistRegular, "400", "normal"],
  [geistMedium, "500", "normal"],
  [geistSemiBold, "600", "normal"],
  [geistBold, "700", "normal"],
  [geistExtraBold, "800", "normal"],
];

export function loadGeist(): void {
  for (const [url, weight, style] of FACES) {
    const face = new FontFace("Geist", `url(${url}) format("truetype")`, {
      weight,
      style,
      display: "swap",
    });
    document.fonts.add(face);
    void face.load().catch(() => {
      // The system sans stays in place if the file fails to load.
    });
  }
}
