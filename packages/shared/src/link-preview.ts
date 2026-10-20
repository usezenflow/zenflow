/** Open Graph / Twitter card metadata of a web page, from `GET /link-preview`. */
export interface LinkPreview {
  title: string | null;
  description: string | null;
  /** Absolute http(s) URL of the card image. */
  image: string | null;
  siteName: string | null;
}
