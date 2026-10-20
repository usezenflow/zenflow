/** A note with no text and no media. */
export function isNoteEmpty(html: string): boolean {
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return text === "" && !/<(img|video|audio)\b/i.test(html);
}
