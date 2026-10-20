import { useEffect, useState } from "react";
import { Check, List } from "lucide-react";
import { createTagsBulk, listTags } from "@/api/tags";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SettingsCard,
  SettingsLabel,
  SettingsRow,
  SettingsSheet,
} from "@/components/settings/settings-ui";
import {
  addCustomTag,
  mergeTagNames,
  newTagsForBulk,
  tagOptions,
  toggleTag,
} from "@/components/settings/settings-utils";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** Suggested tag names, translated at render. */
const SUGGESTED_TAGS = [
  "Study",
  "Exam",
  "Assignment",
  "Project",
  "Lab",
  "Group work",
  "Reading",
  "Revision",
  "Personal",
  "Health",
  "Social",
  "Errands",
] as const;

/** Tags row with the count; the sheet ticks suggested or custom tags and creates the new ones. */
export function TagsSection() {
  useLanguage();
  const [saved, setSaved] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const suggestions = SUGGESTED_TAGS.map((name) => t(name));

  useEffect(() => {
    let active = true;
    listTags()
      .then((tags) => {
        if (active) setSaved(tags.map((tag) => tag.name));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const openSheet = () => {
    setSelected(saved);
    setDraft("");
    setOpen(true);
  };

  async function save() {
    const names = newTagsForBulk(selected, saved);
    if (names.length === 0) {
      setOpen(false);
      return;
    }
    setSaving(true);
    try {
      const tags = await createTagsBulk(names);
      // Merge rather than replace: the response may omit tags that were not sent.
      setSaved((prev) => mergeTagNames(prev, tags.map((tag) => tag.name)));
      setOpen(false);
    } catch {
      errorToast(t("Couldn't save tags"), {
        description: t("Try again in a moment."),
      });
    } finally {
      setSaving(false);
    }
  }

  function addDraft() {
    if (!draft.trim()) return;
    setSelected(addCustomTag(selected, draft, suggestions));
    setDraft("");
  }

  const options = tagOptions(selected, suggestions);

  return (
    <>
      <SettingsLabel>{t("Tags")}</SettingsLabel>
      <SettingsCard>
        <SettingsRow icon={List} title={t("Tags")} value={String(saved.length)} onClick={openSheet} />
      </SettingsCard>

      <SettingsSheet open={open} onOpenChange={setOpen} title={t("Tags")}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {options.map((name) => {
              const on = selected.some((s) => s.toLowerCase() === name.toLowerCase());
              return (
                <button
                  key={name}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  onClick={() => setSelected(toggleTag(selected, name))}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-[14px] transition-colors",
                    on
                      ? "border-primary bg-primary/15 font-semibold text-foreground"
                      : "border-border bg-card font-medium text-muted-foreground",
                  )}
                >
                  {on ? <Check className="size-3.5 text-primary" /> : null}
                  {name}
                </button>
              );
            })}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addDraft();
            }}
          >
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={t("Add a tag")}
              maxLength={50}
            />
            <Button type="submit" variant="outline" disabled={!draft.trim()}>
              {t("Add")}
            </Button>
          </form>
          <Button className="w-full" disabled={saving} onClick={() => void save()}>
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </div>
      </SettingsSheet>
    </>
  );
}
