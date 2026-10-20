import type { Lang } from "@zenflow/shared";

export const LANGUAGES: readonly { value: Lang; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
];

export function languageOption(value: Lang) {
  return LANGUAGES.find((l) => l.value === value) ?? LANGUAGES[0];
}
