import { useState } from "react";
import { ChevronDown, ChevronUp, Minus, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type {
  StudentMarkDto,
  StudentProfileDto,
  StudentTermMarksDto,
} from "@zenflow/shared";
import { fixed } from "@/components/settings/settings-utils";
import { locale, t, useLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const MAX_GPA = 4;
const TREND_STEP = 0.05;

type Trend = "up" | "down" | "flat";
type TrendInfo = { trend: Trend; delta: number };

/** Term GPA change vs the previous term, keyed `yearStudy|termId`. Terms are newest first. */
function termTrends(terms: readonly StudentTermMarksDto[]): Map<string, TrendInfo> {
  const out = new Map<string, TrendInfo>();
  terms.forEach((term, i) => {
    const prev = terms[i + 1];
    if (term.gpa4 === null || prev?.gpa4 == null) return;
    const delta = term.gpa4 - prev.gpa4;
    const trend: Trend =
      delta > TREND_STEP ? "up" : delta < -TREND_STEP ? "down" : "flat";
    out.set(`${term.yearStudy}|${term.termId}`, { trend, delta });
  });
  return out;
}

/** Share of graded, credit-bearing courses that are A, or A and B. */
function gradeShare(terms: readonly StudentTermMarksDto[]) {
  let total = 0;
  let a = 0;
  let ab = 0;
  for (const term of terms) {
    for (const mark of term.marks) {
      if (mark.noCredit || !mark.letter) continue;
      total += 1;
      if (mark.letter === "A") a += 1;
      if (mark.letter === "A" || mark.letter === "B") ab += 1;
    }
  }
  return { total, a, ab };
}

/** One or two short sentences on how the student is doing. */
function interpret(gpa4: number | null, terms: readonly StudentTermMarksDto[]): string[] {
  if (gpa4 === null) return [];
  const lines: string[] = [];
  const { total, a, ab } = gradeShare(terms);
  if (total > 0) {
    const pctA = Math.round((a / total) * 100);
    const pctAb = Math.round((ab / total) * 100);
    if (gpa4 >= 3.6) lines.push(t("Excellent. {pct}% of courses are A", { pct: pctA }));
    else if (gpa4 >= 3.2) lines.push(t("Strong. {pct}% of courses are A or B", { pct: pctAb }));
    else if (gpa4 >= 2.5) lines.push(t("Solid. {pct}% of courses are A or B", { pct: pctAb }));
    else lines.push(t("Room to grow. {pct}% of courses are A or B", { pct: pctAb }));
  }
  const latest =
    terms.length > 0
      ? termTrends(terms).get(`${terms[0].yearStudy}|${terms[0].termId}`)
      : undefined;
  if (latest) {
    const delta = Math.abs(latest.delta).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (latest.trend === "up") lines.push(t("Up {delta} from last semester", { delta }));
    else if (latest.trend === "down") lines.push(t("Down {delta} from last semester", { delta }));
    else lines.push(t("Steady since last semester"));
  }
  return lines;
}

/** "HK02" -> "2". */
function termNumber(termId: string): string {
  return termId.replace(/^HK0?/, "");
}

const LETTER_TONE: Record<string, string> = {
  A: "bg-success/50",
  B: "bg-brand-yellow/20",
  C: "bg-brand-orange/20",
};

const TREND_ICON: Record<Trend, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

function MarkRow({ mark }: { mark: StudentMarkDto }) {
  useLanguage();
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className={cn("text-[14px]", mark.noCredit && "text-muted-foreground")}>
          {mark.curriculumName}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {mark.noCredit ? t("No credit") : `${mark.credits} ${t("credits")}`}
        </p>
      </div>
      <span
        className={cn(
          "w-12 text-right text-[15px] font-semibold tabular-nums",
          mark.noCredit && "text-muted-foreground",
        )}
      >
        {fixed(mark.score10, 1)}
      </span>
      {mark.letter ? (
        <span
          className={cn(
            "flex size-7 items-center justify-center rounded-lg text-[13px] font-bold",
            LETTER_TONE[mark.letter] ?? "bg-destructive/15",
          )}
        >
          {mark.letter}
        </span>
      ) : (
        <span className="w-7" />
      )}
    </div>
  );
}

function TermCard({
  term,
  trend,
  open,
  onToggle,
}: {
  term: StudentTermMarksDto;
  trend: TrendInfo | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  useLanguage();
  const Chevron = open ? ChevronUp : ChevronDown;
  const TrendIcon = trend ? TREND_ICON[trend.trend] : null;
  return (
    <div className="mb-3 overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">
            {t("Semester")} {termNumber(term.termId)} {term.yearStudy}
          </span>
          {term.creditsEarned !== null ? (
            <span className="mt-0.5 block text-[12px] text-muted-foreground">
              {term.creditsEarned} {t("credits")}
            </span>
          ) : null}
        </span>
        {term.gpa4 !== null ? (
          <span className="flex flex-col items-end">
            <span className="text-[17px] font-bold tracking-tight">{fixed(term.gpa4)}</span>
            {trend && TrendIcon ? (
              <span
                className={cn(
                  "flex items-center gap-1 text-[12px] font-semibold",
                  trend.trend === "up" && "text-session-done-ink",
                  trend.trend === "down" && "text-destructive",
                  trend.trend === "flat" && "text-muted-foreground",
                )}
              >
                <TrendIcon className="size-3" />
                {Math.abs(trend.delta).toLocaleString(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            ) : null}
          </span>
        ) : null}
        <Chevron className="size-4 text-muted-foreground" />
      </button>
      {open ? (
        <div className="animate-in fade-in-0 slide-in-from-top-1 border-t border-border px-4 py-1 duration-200">
          {term.marks.map((mark) => (
            <MarkRow key={`${mark.curriculumId}${mark.curriculumName}`} mark={mark} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Bars of term GPA, oldest to newest; the latest is solid. */
function GpaBars({ terms }: { terms: readonly StudentTermMarksDto[] }) {
  const series = terms
    .filter((x) => x.gpa4 !== null)
    .slice(0, 8)
    .reverse();
  if (series.length < 2) return null;
  return (
    <div
      role="img"
      aria-label={t("GPA by semester")}
      className="mt-3 flex h-10 items-end gap-1.5"
    >
      {series.map((term, i) => (
        <span
          key={`${term.yearStudy}${term.termId}`}
          className={cn(
            "flex-1 rounded-sm bg-primary",
            i < series.length - 1 && "opacity-40",
          )}
          style={{ height: `${Math.max(8, ((term.gpa4 ?? 0) / MAX_GPA) * 100)}%` }}
        />
      ))}
    </div>
  );
}

function Summary({
  profile,
  terms,
}: {
  profile: StudentProfileDto;
  terms: readonly StudentTermMarksDto[];
}) {
  useLanguage();
  const lines = interpret(profile.gpa4, terms);
  return (
    <div className="mb-4 rounded-2xl bg-primary/10 p-4">
      <div className="flex items-end gap-4">
        <div>
          <p className="text-[12px] text-muted-foreground">{t("GPA")}</p>
          <p className="text-[34px] font-bold leading-[38px] tracking-tight">
            {fixed(profile.gpa4)}
            <span className="text-[15px] font-medium text-muted-foreground"> / 4.00</span>
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-[17px] font-bold">{profile.creditsEarned ?? ""}</p>
          <p className="text-[12px] text-muted-foreground">{t("Credits")}</p>
        </div>
        {profile.ranking ? (
          <div className="text-right">
            <p className="text-[17px] font-bold">{profile.ranking}</p>
            <p className="text-[12px] text-muted-foreground">{t("Standing")}</p>
          </div>
        ) : null}
      </div>
      <GpaBars terms={terms} />
      {lines.length > 0 ? (
        <p className="mt-3 text-[13px] leading-[19px]">{lines.join(". ")}</p>
      ) : null}
    </div>
  );
}

/** Summary plus marks grouped by term. The newest term opens by default. */
export function MarksSheet({
  profile,
  terms,
}: {
  profile: StudentProfileDto;
  terms: StudentTermMarksDto[];
}) {
  useLanguage();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const trends = termTrends(terms);
  return (
    <div>
      <Summary profile={profile} terms={terms} />
      {terms.map((term, i) => {
        const key = `${term.yearStudy}|${term.termId}`;
        const open = (i === 0) !== closed.has(key);
        return (
          <TermCard
            key={key}
            term={term}
            trend={trends.get(key)}
            open={open}
            onToggle={() =>
              setClosed((prev) => {
                const next = new Set(prev);
                if (!next.delete(key)) next.add(key);
                return next;
              })
            }
          />
        );
      })}
    </div>
  );
}
