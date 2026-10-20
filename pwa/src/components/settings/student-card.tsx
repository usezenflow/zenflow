import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { StudentProfileDto, StudentTermMarksDto } from "@zenflow/shared";
import { getMarks } from "@/api/student";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MarksSheet } from "@/components/settings/marks-sheet";
import { SettingsSheet } from "@/components/settings/settings-ui";
import { fixed } from "@/components/settings/settings-utils";
import { t, useLanguage } from "@/lib/i18n";

const MAX_GPA = 4;

function Chip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-[12px] text-muted-foreground">
      {label}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="block flex-1 rounded-xl bg-muted px-3 py-2">
      <span className="block truncate text-[16px] font-bold tracking-tight">{value}</span>
      <span className="mt-0.5 block text-[12px] text-muted-foreground">{label}</span>
    </span>
  );
}

/** Placeholder card while the DLU profile syncs. */
export function StudentCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3.5">
      <div className="flex items-center gap-3">
        <Skeleton className="size-11 rounded-full" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <div className="flex gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

/** DLU student profile: class, GPA and credits. Opens the marks sheet. */
export function StudentCard({ profile }: { profile: StudentProfileDto }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<StudentTermMarksDto[] | null>(null);
  const [failed, setFailed] = useState(false);

  async function loadMarks() {
    setFailed(false);
    try {
      setTerms((await getMarks()).terms);
    } catch {
      setFailed(true);
    }
  }

  const chips = [profile.faculty, profile.className].filter((x): x is string =>
    Boolean(x),
  );
  const initial = profile.fullName.trim().split(/\s+/).pop()?.charAt(0).toUpperCase() ?? "";

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          if (!terms) void loadMarks();
        }}
        className="flex w-full flex-col gap-3 border-t border-border px-4 py-3.5 text-left transition-colors hover:bg-muted/50"
      >
        <span className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[18px] font-bold text-primary">
            {initial}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[16px] font-semibold">{profile.fullName}</span>
            {profile.studentId ? (
              <span className="mt-0.5 block text-[12px] text-muted-foreground">
                {profile.studentId}
              </span>
            ) : null}
          </span>
          <ChevronRight className="size-[18px] shrink-0 text-muted-foreground" />
        </span>
        {chips.length > 0 ? (
          <span className="flex flex-wrap gap-1.5">
            {chips.map((c) => (
              <Chip key={c} label={c} />
            ))}
          </span>
        ) : null}
        {profile.gpa4 !== null ? (
          <span className="flex flex-col gap-2.5">
            <span className="flex items-baseline gap-1.5">
              <span className="text-[28px] font-bold leading-8 tracking-tight">
                {fixed(profile.gpa4)}
              </span>
              <span className="text-[13px] text-muted-foreground">{t("out of {max} GPA", { max: "4.00" })}</span>
            </span>
            <span className="block h-1.5 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${Math.min(100, (profile.gpa4 / MAX_GPA) * 100)}%` }}
              />
            </span>
            <span className="flex gap-2">
              <Stat label={t("Credits")} value={String(profile.creditsEarned ?? "")} />
              {profile.ranking ? <Stat label={t("Standing")} value={profile.ranking} /> : null}
            </span>
          </span>
        ) : profile.marksFetchedAt === null ? (
          <span className="text-[13px] text-muted-foreground">{t("Marks loading")}</span>
        ) : null}
      </button>

      <SettingsSheet open={open} onOpenChange={setOpen} title={t("Marks")}>
        {terms ? (
          <MarksSheet profile={profile} terms={terms} />
        ) : failed ? (
          <div className="flex flex-col items-start gap-1">
            <p className="text-[14px] text-muted-foreground">{t("Couldn't load marks")}</p>
            <Button variant="link" className="h-auto p-0" onClick={() => void loadMarks()}>
              {t("Retry")}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3" aria-label={t("Loading marks")}>
            <Skeleton className="h-28 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
            <Skeleton className="h-14 rounded-2xl" />
          </div>
        )}
      </SettingsSheet>
    </>
  );
}
