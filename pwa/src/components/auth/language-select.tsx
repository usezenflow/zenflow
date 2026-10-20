import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getLanguage, setLanguage, t, useLanguage, type Language } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";

import { LANGUAGES as OPTIONS } from "@/lib/languages";

/**
 * Compact language pill that switches the UI before sign-in. The choice is
 * cached on this device; signing in then applies it to the account.
 */
export function LanguageSelect() {
  const language = useLanguage();
  const current = OPTIONS.find((o) => o.value === getLanguage());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="glass h-9 rounded-full px-3"
          aria-label={t("Language")}
        >
          <span aria-hidden className="text-[16px] leading-none">{current?.flag}</span>
          <span className="text-[13px] font-semibold">{current?.label}</span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={language}
          onValueChange={(next) => setLanguage(next as Language)}
        >
          {OPTIONS.map((o) => (
            <DropdownMenuRadioItem key={o.value} value={o.value}>
              <span aria-hidden className="text-[16px] leading-none">{o.flag}</span>
              {o.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
