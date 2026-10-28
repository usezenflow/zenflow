import {
  bulkCreateSessions,
  bulkDeleteSessions,
  bulkUpdateSessions,
  listSessions,
  listSessionSuggestions,
  updateSession,
} from "@/api/tasks";
import { HomeShell } from "@/components/palette/home-shell";
import { Ico, type IconName } from "@/components/palette/icons";
import {
  DurationMenu,
  EditMenu,
  MentionList,
  RangeMenu,
  TargetChip,
  minutesLabel,
  type EditAction,
  type TextField,
} from "@/components/palette/menus";
import { Pill } from "@/components/palette/pill";
import { StarterChips } from "@/components/palette/starter-chips";
import { ReadChips, repeatLabel } from "@/components/palette/read-chips";
import { SprintSheet } from "@/components/palette/sprint-sheet";
import { PanelRow, ResultPanel } from "@/components/palette/result-panel";
import { CommitToast } from "@/components/palette/commit-toast";
import { ClashSheet } from "@/components/palette/clash-sheet";
import { PairSheet } from "@/components/palette/pair-sheet";
import {
  DayPreview,
  FailedView,
  FooterBar,
  FreeView,
  LineCards,
  ModeMenu,
  OfflineBanner,
  PreviewSkeleton,
  RecapView,
  ReplanView,
  type LineCard,
} from "@/components/palette/views";
import { selectOffline, useConnectivity } from "@/lib/connectivity";
import { Text } from "@/components/ui/text";
import { useToast } from "@/components/ui/toast";
import { useLanguage } from "@/hooks/use-language";
import { useUserStore } from "@/hooks/use-user-store";
import { format, t } from "@/lib/i18n";
import {
  addLines,
  checkCommand,
  parseCommand,
  RANGE_VERBS,
  TARGET_VERBS,
  type Range,
  type Verb,
} from "@/lib/palette/command";
import { placeholderFor } from "@/lib/palette/placeholder";
import { pairOffers, type PairOffer } from "@/lib/palette/gate";
import {
  emptyState,
  medianMinutes,
  merge,
  record,
  recordEdit,
  seed,
  type PaletteState,
} from "@/lib/palette/history";
import { homeSuggestions, type Suggestion } from "@/lib/palette/home";
import { buildItems, createdLines } from "@/lib/palette/items";
import { freeAfterNow } from "@/lib/palette/free-now";
import { clashOf, settle, type Clash } from "@/lib/palette/clash";
import { itemError, reportError } from "@/lib/palette/errors";
import type { Change } from "@/lib/palette/edits";
import {
  deadlineOf,
  editFrom,
  notBeforeOf,
  repeatOf,
  understand,
  type Understood,
} from "@/lib/palette/understand";
import { getFreeSlots as freeSlotsApi } from "@/api/insights";
import { paletteDisk } from "@/lib/palette/palette-disk";
import { syncPalette } from "@/lib/palette/sync";
import { runVerb, type VerbResult } from "@/lib/palette/verbs";
import { deferCommit } from "@/lib/undo";
import type {
  BulkCreateItemResult,
  CreateSessionInput,
  ReplanChange,
  Session,
} from "@zenflow/shared";
import { addDays, startOfDay } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

const DAY = 86_400_000;

/** A dry run of what Send would add, shown before anything is saved. */
interface Review {
  items: CreateSessionInput[];
  owner: number[];
  lines: string[];
  results: BulkCreateItemResult[];
}

const VERB_ROWS: {
  id: Verb;
  word: string;
  title: string;
  sub: string;
  icon: IconName;
}[] = [
  {
    id: "add",
    word: "add",
    title: "Add",
    sub: "Add a task or a fixed event",
    icon: "plus",
  },
  {
    id: "edit",
    word: "edit",
    title: "Edit",
    sub: "Move, resize or change a task",
    icon: "pencil",
  },
  {
    id: "delete",
    word: "delete",
    title: "Delete",
    sub: "Delete one or more tasks",
    icon: "trash",
  },
  {
    id: "free",
    word: "free",
    title: "Free",
    sub: "See free time for a length",
    icon: "find",
  },
  {
    id: "view",
    word: "view",
    title: "View",
    sub: "See a day or a week",
    icon: "eye",
  },
  {
    id: "recap",
    word: "recap",
    title: "Recap",
    sub: "See your week",
    icon: "bars",
  },
  {
    id: "replan",
    word: "replan",
    title: "Replan",
    sub: "Tidy up the plan",
    icon: "wand",
  },
  {
    id: "undo",
    word: "undo",
    title: "Undo",
    sub: "Undo the last change",
    icon: "undo",
  },
];

const norm = (v: string) =>
  v.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").toLowerCase();

export default function HomeScreen() {
  useLanguage();
  const { toast } = useToast();
  const user = useUserStore((s) => s.user);
  const userId = user?.id;
  const [text, setText] = useState("");
  // Words the user said are not a length, day or time; they stay in the title.
  const [skip, setSkip] = useState<ReadonlySet<string>>(new Set());
  const [targets, setTargets] = useState<Session[]>([]);
  const [range, setRange] = useState<Range | null>(null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [action, setAction] = useState<EditAction | null>(null);
  const [textField, setTextField] = useState<TextField | null>(null);
  const [mentioning, setMentioning] = useState(false);
  const [tight, setTight] = useState<{
    need: number;
    left: number;
    line: number;
    fixed: Record<number, Understood>;
  } | null>(null);
  const [clash, setClash] = useState<{
    line: number;
    kind: Clash;
    fixed: Record<number, Understood>;
    caps: Record<number, number>;
  } | null>(null);
  const [calendar, setCalendar] = useState<Session[]>([]);
  const [verb, setVerb] = useState<VerbResult | null>(null);
  const [pending, setPending] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [palette, setPalette] = useState<PaletteState>(emptyState);
  const [cards, setCards] = useState<Suggestion[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const offline = useConnectivity(selectOffline);
  const [mode, setMode] = useState<ReplanChange | null>(null);
  const [slotIdx, setSlotIdx] = useState(0);
  const [settled, setSettled] = useState(false);
  const [commit, setCommit] = useState<{
    title: string;
    onUndo: () => void;
  } | null>(null);
  const [pairs, setPairs] = useState<PairOffer[]>([]);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [review, setReview] = useState<Review | null>(null);

  const cmd = useMemo(() => parseCommand(text), [text]);
  const isAdd = cmd.verb === "add";

  const reset = useCallback(() => {
    setTargets([]);
    setRange(null);
    setMinutes(null);
    setAction(null);
    setTextField(null);
    setMentioning(false);
    setVerb(null);
    setAttempted(false);
    setPending(false);
    setReview(null);
    setMode(null);
    setSlotIdx(0);
    setSettled(false);
  }, []);
  const edit = useCallback(
    (next: string) => {
      setText(next);
      if (!next) setSkip(new Set());
      setAttempted(false);
      setPending(false);
      setReview(null);
      setAdding(false);
      // Changing the verb word starts the command over; typing arguments keeps the chips.
      if (parseCommand(next).verb !== cmd.verb) reset();
    },
    [cmd.verb, reset],
  );

  // Local copy first; a first launch learns from existing sessions, then merges the server backup.
  useEffect(() => {
    if (!userId) return;
    let state = paletteDisk.load(userId);
    setPalette(state);
    const empty = !Object.keys(state.titles).length;
    void (async () => {
      try {
        if (empty)
          state = merge(
            state,
            seed(await listSessionSuggestions("", 50), Date.now()),
          );
        state = await syncPalette(state);
      } catch {
        // Offline: the local copy still works and the next launch retries.
      }
      paletteDisk.save(userId, state);
      setPalette(state);
    })();
  }, [userId]);

  // Cards for an empty field and the `@` list share one calendar fetch; each source may fail alone.
  useEffect(() => {
    if (!userId) return;
    const now = new Date();
    const back = new Date(now.getTime() - 7 * DAY);
    void Promise.allSettled([
      listSessions(back, back),
      listSessions(back, new Date(now.getTime() + 14 * DAY)),
      listSessions(now, now),
    ]).then(([last, around, today]) => {
      if (around.status === "fulfilled") setCalendar(around.value.sessions);
      if (today.status === "fulfilled")
        setLeft(
          today.value.sessions.filter(
            (s) =>
              s.scheduledStartTime &&
              new Date(s.scheduledStartTime).getTime() +
                s.durationMinutes * 60_000 >
                now.getTime(),
          ).length,
        );
      setCards(
        homeSuggestions({
          now,
          lastWeek: last.status === "fulfilled" ? last.value.sessions : null,
          today: today.status === "fulfilled" ? today.value.sessions : null,
        }),
      );
    });
  }, [userId]);

  // Add: one line is one task and a bare title is complete. Nothing goes to the server until Send.
  const lines = useMemo(
    () => (isAdd ? addLines(cmd.rest) : []),
    [isAdd, cmd.rest],
  );

  // Each line is read for a length, a day, a clock time and a part of the day; the rest is its title.
  const read = useMemo(
    () => lines.map((l) => understand(l, new Date(), skip)),
    [lines, skip],
  );

  const error = checkCommand({
    cmd,
    text: isAdd ? read.map((r) => r.title).join("\n") : cmd.rest,
    targets: targets.length,
    range,
    minutes,
  });
  const typedEdit =
    cmd.verb === "edit" && targets.length && !action && !textField
      ? editFrom(understand(cmd.rest, new Date(), skip))
      : null;
  const edited = textField ? cmd.rest.trim() : null;

  // Read verbs run as soon as their range (and length) is picked.
  useEffect(() => {
    setVerb(null);
    setFailed(false);
    if (
      !RANGE_VERBS.includes(cmd.verb) ||
      !range ||
      (cmd.verb === "free" && !minutes) ||
      (cmd.verb === "replan" && !mode) ||
      checkCommand({ cmd, text: cmd.rest, targets: 0, range, minutes })
    )
      return;
    void runVerb(cmd.verb, range, minutes, mode).then(setVerb, () =>
      setFailed(true),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.verb, range, minutes, mode, attempt]);

  const undoable = (
    done: string,
    run: () => Promise<unknown>,
    restore?: () => void,
  ) => {
    const cancel = deferCommit(
      () =>
        void run().catch((e) =>
          toast({
            title: t("Request failed"),
            description: reportError(cmd.verb, e),
            variant: "destructive",
          }),
        ),
    );
    setCommit({
      title: done,
      onUndo: () => {
        cancel();
        restore?.();
        setCommit(null);
        setSettled(false);
        setReview(null);
      },
    });
  };

  // A length that cannot fit in the free time before its deadline offers a sprint instead of a failed add.
  const tightLine = async (
    rows: { minutes?: number; deadline?: Date }[],
    now: Date,
  ) => {
    for (const [line, r] of rows.entries()) {
      if (!r.minutes || !r.deadline) continue;
      const free = await freeSlotsApi(now, r.deadline, 15).catch(() => null);
      const left = free
        ? freeAfterNow(free, 15, now).reduce((n, f) => n + f.freeMinutes, 0)
        : r.minutes;
      if (left < r.minutes) return { need: r.minutes, left, line };
    }
    return null;
  };

  // Every line is its own task: nothing is carried over from the line above.
  const inherited = (caps: Record<number, number> = {}) =>
    read.map((u, i) => ({ ...u, minutes: caps[i] ?? u.minutes }));

  // Send asks the scheduler where each task would land. Nothing is saved until the preview is confirmed.
  const add = async (
    caps: Record<number, number> = {},
    fixed: Record<number, Understood> = {},
  ) => {
    setPending(true);
    try {
      const now = new Date();
      const given = inherited(caps).map((u, i) => fixed[i] ?? u);
      for (const [line, u] of given.entries()) {
        const kind = line in fixed ? null : clashOf(u, now);
        if (kind) return setClash({ line, kind, fixed, caps });
      }
      const lines_ = given.map((u) => {
        const rep = repeatOf(u, now);
        const fixed = rep?.start;
        return {
          title: u.title,
          minutes: u.minutes,
          window: u.window,
          parts: u.split,
          notBefore: notBeforeOf(u, now),
          location: u.place,
          ...(fixed
            ? { type: "DND" as const, start: fixed, rrule: rep.rrule }
            : rep
              ? { repeatDeadlines: rep.deadlines }
              : { deadline: deadlineOf(u, now) }),
        };
      });
      const clash = await tightLine(lines_, now);
      if (clash) return setTight({ ...clash, fixed });
      const built = buildItems(lines_, now, (title) =>
        medianMinutes(palette, title),
      );
      if (!built)
        return toast({
          title: t("Deadline too close for that length."),
          variant: "destructive",
        });
      const { results } = await bulkCreateSessions({
        items: built.items,
        dryRun: true,
      });
      setReview({ ...built, lines: given.map((u) => u.title), results });
    } catch (e) {
      toast({
        title: t("Request failed"),
        description: reportError("add", e),
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  const added = (titles: string[]) =>
    titles.length === 1
      ? t("Added {title}", { title: titles[0] })
      : t("Added {n} tasks", { n: titles.length });

  const confirmAdd = () => {
    if (!review) return;
    const { items, owner, lines: sentLines } = review;
    const sent = text;
    setSettled(true);
    setText("");
    undoable(
      added(sentLines),
      async () => {
        const { results } = await bulkCreateSessions({ items });
        const failed = results.flatMap((r) =>
          r.status === "ERROR" ? [itemError(r)] : [],
        );
        if (failed.length)
          toast({
            title: t("{n} not added", { n: failed.length }),
            description: failed[0],
            variant: "destructive",
          });
        setPairs(pairOffers(results, items));
        if (userId) {
          const next = structuredClone(palette);
          const ok = createdLines(results, owner);
          sentLines.forEach(
            (title, i) =>
              ok.has(i) &&
              record(
                next,
                {
                  title,
                  durationMinutes:
                    items.find((_, k) => owner[k] === i)?.durationMinutes ?? 60,
                },
                Date.now(),
              ),
          );
          paletteDisk.save(userId, next);
          setPalette(next);
          void syncPalette(next).catch(() => {});
        }
      },
      () => setText(sent),
    );
  };

  const patchTargets = (a: EditAction | (Change & { label: string })) => {
    const sent = targets;
    if (userId && "id" in a) {
      const next = structuredClone(palette);
      recordEdit(
        next,
        a.id,
        sent.map((x) => x.title),
        Date.now(),
      );
      paletteDisk.save(userId, next);
      setPalette(next);
      void syncPalette(next).catch(() => {});
    }
    undoable(a.label, async () => {
      const { results } = await bulkUpdateSessions({
        items: sent.map((s) => ({ id: s.id, patch: a.patch(s, new Date()) })),
      });
      const bad = results.flatMap((r) =>
        r.status === "ERROR" ? [itemError(r)] : [],
      );
      if (bad.length)
        toast({
          title: t("{n} not changed", { n: bad.length }),
          description: bad[0],
          variant: "destructive",
        });
    });
    edit("");
    reset();
  };

  const send = () => {
    if (offline) return;
    if (error) return setAttempted(true);
    if (cmd.verb === "add") lines.length && void add();
    else if (cmd.verb === "delete") {
      undoable(
        targets.length === 1
          ? t("Deleted {title}", { title: targets[0].title })
          : t("Deleted {n} tasks", { n: targets.length }),
        () =>
        bulkDeleteSessions({
          items: targets.map((s) => ({ kind: "session" as const, id: s.id })),
        }),
      );
      edit("");
      reset();
    } else if (cmd.verb === "edit") {
      if (textField && edited)
        patchTargets({
          label: `${t(textField)}: ${edited}`,
          patch: () => ({ [textField]: edited }),
        });
      else if (action) patchTargets(action);
      else if (typedEdit)
        patchTargets({
          label: cmd.rest.trim(),
          patch: (x: Session) => typedEdit(x, new Date()),
        });
      else setAttempted(true);
    } else if (cmd.verb === "free") {
      const slot = verb?.kind === "free" ? verb.slots[slotIdx] : null;
      if (!slot) return setAttempted(true);
      if (!cmd.rest.trim())
        return toast({
          title: t("Type a title first."),
          variant: "destructive",
        });
      const title = cmd.rest.trim();
      const minutes_ = minutes ?? 60;
      const item: CreateSessionInput = {
        type: "TASK",
        title,
        durationMinutes: minutes_,
        notBefore: slot.start,
        deadline: slot.end,
      };
      undoable(added([title]), async () => {
        const { results } = await bulkCreateSessions({ items: [item] });
        const bad = results.find((r) => r.status === "ERROR");
        if (bad && bad.status === "ERROR")
          toast({
            title: t("{n} not added", { n: 1 }),
            description: itemError(bad),
            variant: "destructive",
          });
        setPairs(pairOffers(results, [item]));
      });
      edit("");
      reset();
    } else if (cmd.verb === "undo") {
      void runVerb("undo", null, null).then(setVerb, () => setFailed(true));
    }
  };
  const pickVerb = (id: Verb, word: string) => {
    reset();
    setText(id === "add" ? "" : `${word} `);
    if (id === "add") setAdding(true);
    setMentioning(TARGET_VERBS.includes(id));
  };

  const mention = /(?:^|\s)@(\S*)$/.exec(text);
  const showMentions = TARGET_VERBS.includes(cmd.verb)
    ? (mentioning || !!mention) && targets.length < 20
    : !!mention;
  const pickTarget = (s: Session) => {
    setTargets((x) => (x.some((y) => y.id === s.id) ? x : [...x, s]));
    setText(
      text.replace(/(?:^|\s)@\S*$/, "").trimEnd() +
        (cmd.verb === "add" ? "" : " "),
    );
    setMentioning(false);
  };

  const pickAll = (rows: Session[]) => {
    setTargets((x) =>
      [...x, ...rows.filter((r) => !x.some((y) => y.id === r.id))].slice(0, 20),
    );
    setText(text.replace(/(?:^|\s)@\S*$/, "").trimEnd() + " ");
    setMentioning(false);
  };

  const typed = norm(text.trimStart());
  const verbRows = VERB_ROWS.map((r) => ({
    ...r,
    title: t(r.title),
    sub: t(r.sub),
  })).filter((r) => norm(r.title).startsWith(typed));
  const showVerbs =
    focused &&
    isAdd &&
    !adding &&
    !review &&
    !text.includes("\n") &&
    verbRows.length > 0 &&
    !mention;
  const now = new Date();
  const needRange =
    RANGE_VERBS.includes(cmd.verb) && !range && cmd.verb !== "free";
  const needMinutes = cmd.verb === "free" && !minutes;
  const needRangeFree = cmd.verb === "free" && !!minutes && !range;

  const shown = isAdd ? text : text.slice(cmd.consumed).replace(/^ /, "");
  const chips = (
    <>
      {targets.map((s) => (
        <TargetChip
          key={s.id}
          label={s.title}
          onRemove={() => setTargets((x) => x.filter((y) => y.id !== s.id))}
        />
      ))}
      {minutes ? (
        <TargetChip
          label={minutesLabel(minutes)}
          onRemove={() => setMinutes(null)}
        />
      ) : null}
      {range ? (
        <TargetChip
          label={`${format(range.from, "d/M")} ${t("to")} ${format(range.to, "d/M")}`}
          onRemove={() => setRange(null)}
        />
      ) : null}
      {mode ? (
        <TargetChip
          label={t(mode === "free" ? "Free up" : "Balanced")}
          onRemove={() => setMode(null)}
        />
      ) : null}
      {action ? (
        <TargetChip label={action.label} onRemove={() => setAction(null)} />
      ) : null}
    </>
  );

  const last =
    cmd.verb === "edit" && !review
      ? understand(cmd.rest, new Date(), skip)
      : null;
  const pill = (
    <>
      <Pill
        value={shown}
        badge={
          isAdd
            ? adding || review || pending || text.trim()
              ? t("Add")
              : null
            : t(VERB_ROWS.find((r) => r.id === cmd.verb)?.title ?? "")
        }
        chips={chips}
        onBackspaceEmpty={() => edit("")}
        placeholder={placeholderFor({
          verb: cmd.verb,
          targets: targets.length,
          hasAction: !!action,
          minutes,
          hasRange: !!range,
          hasMode: !!mode,
          hasSlot: verb?.kind === "free" && !!verb.slots[slotIdx],
        })}
        busy={pending}
        canSend={!pending && !offline}
        onChangeText={(next) =>
          edit(isAdd ? next : `${text.slice(0, cmd.consumed)} ${next}`)
        }
        onSend={send}
        onFocusChange={setFocused}
      />
      {last && !review ? (
        <ReadChips u={last} onSkip={(w) => setSkip((x) => new Set(x).add(w))} />
      ) : null}
    </>
  );

  const shownError = attempted ? error : null;

  // While typing: one card per line with what was read, and no time yet. The scheduler runs on send.
  const draftCards: LineCard[] =
    isAdd && !review && !pending && text.trim()
      ? inherited().map((u, i) => {
          const at = new Date();
          const chips: LineCard["chips"] = [];
          if (u.minutes)
            chips.push({ kind: "length", label: minutesLabel(u.minutes) });
          const dl = deadlineOf(u, at);
          if (dl)
            chips.push({
              kind: "day",
              label: t("by {when}", {
                when: format(dl, u.time != null ? "EEE d/M HH:mm" : "EEE d/M"),
              }),
            });
          if (u.window)
            chips.push({
              kind: "part",
              label: t(
                u.window === "MORNING"
                  ? "Morning"
                  : u.window === "AFTERNOON"
                    ? "Afternoon"
                    : "Evening",
              ),
            });
          const nb = notBeforeOf(u, at);
          if (nb)
            chips.push({
              kind: "from",
              label: t("From {when}", { when: format(nb, "EEE d/M HH:mm") }),
            });
          if (u.place) chips.push({ kind: "place", label: u.place });
          if (u.repeat) chips.push({ kind: "repeat", label: repeatLabel(u) });
          if (u.split)
            chips.push({
              kind: "split",
              label: t("{n} blocks", { n: u.split }),
            });
          // A fixed series has its time already, so it shows now; flexible tasks wait for the scheduler.
          const start = repeatOf(u, at)?.start;
          return {
            index: i,
            title: u.title,
            slot: start ? format(start, "EEE d/M HH:mm") : null,
            chips,
            error: null,
          };
        })
      : [];
  const lineCards: LineCard[] = review
    ? review.lines.map((title, i) => {
        const k = review.owner.indexOf(i);
        const it = review.items[k];
        const r = review.results[k];
        const chips: LineCard["chips"] = [];
        if (it?.durationMinutes)
          chips.push({
            kind: "length",
            label: minutesLabel(it.durationMinutes),
          });
        if (it && "deadline" in it && it.deadline)
          chips.push({
            kind: "day",
            label: t("by {when}", {
              when: format(new Date(it.deadline), "EEE"),
            }),
          });
        if (it && "window" in it && it.window)
          chips.push({
            kind: "part",
            label: t(
              it.window === "MORNING"
                ? "Morning"
                : it.window === "AFTERNOON"
                  ? "Afternoon"
                  : "Evening",
            ),
          });
        if (it && "notBefore" in it && it.notBefore)
          chips.push({
            kind: "from",
            label: t("From {when}", {
              when: format(new Date(it.notBefore), "EEE d/M HH:mm"),
            }),
          });
        if (it && "location" in it && it.location)
          chips.push({ kind: "place", label: it.location });
        if (r?.status === "PROPOSED")
          for (const w of r.warnings ?? [])
            chips.push({ kind: "warn", label: t(w) });
        const slot =
          r?.status === "PROPOSED"
            ? r.proposedStart
              ? format(new Date(r.proposedStart), "EEE d/M HH:mm")
              : null
            : null;
        const error =
          r?.status === "ERROR"
            ? itemError(r)
            : r?.status === "PROPOSED" && !r.proposedStart
              ? t("No free slot")
              : null;
        return { index: i, title: it?.title ?? title, slot, chips, error };
      })
    : [];
  const slot = verb?.kind === "free" ? verb.slots[slotIdx] : null;
  const footer =
    pending && isAdd ? (
      <FooterBar
        secondary={t("Edit")}
        primary={t("Scheduling")}
        busy
        onSecondary={() => {
          setPending(false);
          setReview(null);
        }}
        onPrimary={() => {}}
      />
    ) : review && !settled ? (
      <FooterBar
        secondary={t("Edit")}
        primary={t("Add {n} tasks", { n: review.items.length })}
        disabled={review.results.every((r) => r.status === "ERROR")}
        onSecondary={() => setReview(null)}
        onPrimary={confirmAdd}
      />
    ) : verb?.kind === "replan" ? (
      <FooterBar
        secondary={t("Skip")}
        primary={t("Apply {n} changes", { n: verb.preview.moves.length })}
        disabled={!verb.preview.moves.length}
        onSecondary={() => {
          edit("");
          reset();
        }}
        onPrimary={async () => {
          toast({ title: await verb.confirm() });
          edit("");
          reset();
        }}
      />
    ) : slot ? (
      <FooterBar
        secondary={t("Cancel")}
        primary={t("Add at {when}", {
          when: format(new Date(slot.start), "EEE HH:mm"),
        })}
        onSecondary={() => {
          edit("");
          reset();
        }}
        onPrimary={send}
      />
    ) : null;
  const overlay = (
    <>
      {footer}
      {commit && (
        <CommitToast
          title={commit.title}
          onUndo={commit.onUndo}
          onDone={() => {
            setCommit(null);
            setReview(null);
            setSettled(false);
          }}
        />
      )}
      {pairs.length > 0 && (
        <PairSheet offers={pairs} onClose={() => setPairs([])} />
      )}
    </>
  );

  const panel = (
    <>
      {showVerbs && (
        <ResultPanel testID="verb-list">
          {verbRows.map((r, i) => (
            <PanelRow
              key={r.id}
              testID={`verb-${r.id}`}
              icon={r.icon}
              title={r.title}
              sub={r.sub}
              prefix={typed.length}
              selected={typed.length > 0 && i === 0}
              onPress={() => pickVerb(r.id, r.word)}
            />
          ))}
        </ResultPanel>
      )}

      {showMentions && (
        <MentionList
          sessions={calendar}
          query={mention?.[1] ?? ""}
          onPick={pickTarget}
          onPickAll={pickAll}
        />
      )}
      {!showMentions && needMinutes && <DurationMenu onPick={setMinutes} />}
      {!showMentions && (needRange || needRangeFree) && (
        <RangeMenu
          now={now}
          allowPast={cmd.verb === "recap"}
          onPick={setRange}
          icon={cmd.verb === "recap" ? "bars" : "calendar"}
        />
      )}
      {!showMentions && cmd.verb === "replan" && !!range && !mode && (
        <ModeMenu onPick={setMode} />
      )}
      {!showMentions &&
        cmd.verb === "edit" &&
        targets.length > 0 &&
        !action &&
        !textField && (
          <EditMenu now={now} onAction={setAction} onText={setTextField} />
        )}
      {verb?.kind === "undo" && (
        <ResultPanel>
          <PanelRow icon="check" title={verb.message} />
        </ResultPanel>
      )}
    </>
  );

  return (
    <HomeShell
      empty={!text.trim() && !focused}
      panel={panel}
      left={left}
      pill={pill}
      overlay={overlay}
    >
      {shownError && (
        <View
          testID="palette-error"
          className="mx-4 mt-3 flex-row items-center gap-2 rounded-2xl border border-destructive/40 bg-destructive/5 px-3 py-2"
        >
          <Ico name="x" size={16} color="#EF4444" />
          <Text className="min-w-0 flex-1 text-[13.5px] text-destructive">
            {shownError}
          </Text>
        </View>
      )}

      <OfflineBanner />
      {draftCards.length > 0 && (
        <>
          <LineCards cards={draftCards} onFix={() => {}} />
          <View style={{ height: 110 }} />
        </>
      )}
      {pending && isAdd && <PreviewSkeleton />}
      {review && (
        <>
          {!settled && (
            <LineCards cards={lineCards} onFix={() => setReview(null)} />
          )}
          <View style={{ height: 110 }} />
        </>
      )}

      {!text.trim() && !review && !adding && cards.length > 0 && (
        <StarterChips
          cards={cards}
          onPick={(c) => (c.verb ? pickVerb(c.verb, c.verb) : edit(c.text))}
        />
      )}

      {clash && (
        <ClashSheet
          clash={clash.kind}
          onClose={() => setClash(null)}
          onKeep={(keep) => {
            const { line, kind, fixed, caps } = clash;
            setClash(null);
            const u = inherited(caps)[line];
            void add(caps, {
              ...fixed,
              [line]: settle(u, keep, new Date()),
            });
          }}
        />
      )}

      {tight && (
        <SprintSheet
          need={tight.need}
          left={tight.left}
          onLater={() => setTight(null)}
          onSprint={() => {
            const row = tight;
            setTight(null);
            const shrunk = Math.floor(row.left / 15) * 15;
            if (shrunk < 15)
              return toast({
                title: t("No free time before the deadline"),
                variant: "destructive",
              });
            void add({ [row.line]: shrunk }, row.fixed);
          }}
        />
      )}

      {textField && !action && (
        <Text className="mx-6 mt-3 text-[13px] text-muted-foreground">
          {t("Type the new {field}, then send.", {
            field: t(textField).toLowerCase(),
          })}
        </Text>
      )}

      {failed && <FailedView onRetry={() => setAttempt((n) => n + 1)} />}
      {verb?.kind === "recap" && (
        <RecapView
          recap={verb.recap}
          prev={verb.prev}
          from={verb.range.from}
          to={verb.range.to}
          onReplan={() => {
            reset();
            setText("replan ");
          }}
          onFree={() => {
            reset();
            setText("free ");
          }}
        />
      )}
      {verb?.kind === "free" && (
        <FreeView
          slots={verb.slots}
          picked={slotIdx}
          onPick={setSlotIdx}
          onTry={
            minutes && minutes > 30
              ? () => setMinutes(Math.max(30, Math.floor(minutes / 30) * 15))
              : undefined
          }
        />
      )}
      {verb?.kind === "replan" && (
        <>
          <ReplanView
            preview={verb.preview}
            from={range?.from ?? new Date()}
            to={range?.to ?? new Date()}
          />
        </>
      )}
      {verb?.kind === "view" && (
        <DayPreview proposed={[]} first={verb.range.from} />
      )}
    </HomeShell>
  );
}
