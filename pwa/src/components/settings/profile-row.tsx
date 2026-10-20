import { useState } from "react";
import { toast } from "@/lib/notify";
import { ChevronRight, Lock } from "lucide-react";
import type { User } from "@zenflow/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SettingsSheet } from "@/components/settings/settings-ui";
import { initials, maskEmail } from "@/components/settings/settings-utils";
import { saveUser } from "@/components/settings/save-user";
import { t, useLanguage } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";

/** Avatar, name and masked email; opens an edit sheet. Only the name is editable: email is the sign-in identity. */
export function ProfileRow({ user }: { user: User }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(user.name);
  const [saving, setSaving] = useState(false);

  const openSheet = () => {
    setName(user.name);
    setOpen(true);
  };

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === user.name) {
      setOpen(false);
      return;
    }
    setSaving(true);
    const ok = await saveUser({ name: trimmed });
    setSaving(false);
    if (ok) {
      toast.success(t("Profile updated"));
      setOpen(false);
    } else {
      errorToast(t("Couldn't update profile"), {
        description: t("Try again in a moment."),
      });
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openSheet}
        className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex size-[46px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-orange via-brand-yellow to-brand-lime text-base font-bold tracking-tight text-primary-foreground">
          {initials(user.name)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-semibold">{user.name}</span>
          <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">
            {maskEmail(user.email)}
          </span>
        </span>
        <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
      </button>

      <SettingsSheet
        open={open}
        onOpenChange={setOpen}
        title={t("Edit profile")}
        description={t("Update how your name appears in Zenflow.")}
      >
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t("Name")}</Label>
            <Input
              id="profile-name"
              className="h-11 rounded-xl text-base"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Email")}</Label>
            <div className="flex h-9 items-center justify-between rounded-md border border-input bg-muted/50 px-3 text-sm text-muted-foreground">
              <span>{user.email}</span>
              <Lock className="size-4 shrink-0" />
            </div>
            <p className="text-[13px] leading-snug text-muted-foreground">
              {t("Your email is how you sign in, so it can't be changed here.")}
            </p>
          </div>
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? t("Saving…") : t("Save changes")}
          </Button>
        </form>
      </SettingsSheet>
    </>
  );
}
