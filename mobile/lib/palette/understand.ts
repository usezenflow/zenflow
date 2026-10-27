import { MAX_BULK_SESSIONS, MAX_SPLIT_CHUNKS } from "@zenflow/shared";
import type {
  SessionWindow,
  UpdateSessionInput,
  Session,
} from "@zenflow/shared";
import { addDays, setDay, startOfDay, startOfWeek } from "date-fns";
import {
  AT,
  CLOCK_PART,
  DAYS,
  HOUR_UNIT,
  JOIN,
  MIN_UNIT,
  PARTS,
  THU,
  TODAY,
  TOMORROW,
  PLACE,
  canon,
  fromLen,
  num,
} from "./lexicon";
import { fold } from "./normalize";

export type SpanKind =
  | "length"
  | "day"
  | "clock"
  | "part"
  | "from"
  | "place"
  | "repeat"
  | "split";

/** A phrase read from a line, as offsets in the original text. */
export interface Span {
  start: number;
  end: number;
  kind: SpanKind;
  /** First word the phrase was read from, folded. Passing it back in `skip` leaves the phrase in the title. */
  word: string;
}

export interface Repeat {
  freq: "DAILY" | "WEEKLY";
  /** getDay of each weekday, for weekly: "every mon, tue". */
  days?: number[];
}

export interface Understood {
  /** The line without what was read. */
  title: string;
  minutes?: number;
  day?: Date;
  /** Minutes after midnight. */
  time?: number;
  window?: SessionWindow;
  /** "after fri", "no sooner than 3pm": the task may not start before this. */
  from?: { day?: Date; time?: number };
  /** "at library", "tai thu vien": free text location. */
  place?: string;
  /** "every mon", "moi ngay", "hang tuan". */
  repeat?: Repeat;
  /** "in 2 blocks", "chia 2 buoi": how many blocks a long task is cut into. */
  split?: number;
  spans: Span[];
}

type Read = {
  used: number;
  kind: SpanKind;
  apply: (u: Understood, now: Date) => void;
};

/** Next date for a weekday; today's name means next week, like the rest of the palette. */
function nextDay(dow: number, now: Date): Date {
  const d = setDay(startOfDay(now), dow, { weekStartsOn: 1 });
  return d <= startOfDay(now) ? addDays(d, 7) : d;
}

const len = (min: number, used = 1): Read | null =>
  min >= 5 && min <= 720
    ? { used, kind: "length", apply: (u) => void (u.minutes = min) }
    : null;
const clock = (h: number, m: number, used = 1): Read | null =>
  h < 24 && m < 60
    ? { used, kind: "clock", apply: (u) => void (u.time = h * 60 + m) }
    : null;
const day = (used: number, at: (now: Date) => Date): Read => ({
  used,
  kind: "day",
  apply: (u, now) => void (u.day = at(now)),
});
const isHalf = (s?: string) => s === "ruoi";
/** An afternoon or evening word turns 7 into 19. */
const withPart = (h: number, part?: string) =>
  h < 12 &&
  (CLOCK_PART[part ?? ""] === "AFTERNOON" ||
    CLOCK_PART[part ?? ""] === "EVENING")
    ? h + 12
    : h;

/** A weekday phrase at w[i] as [getDay, words]: "t2", "thu 2", "thu hai", "chu nhat". */
function weekdayAt(
  w: string[],
  raw: string[],
  i: number,
): [number, number] | null {
  const a = w[i];
  const b = w[i + 1];
  if ((a === "chu" || a === "chua") && (b === "nhat" || b === "nhut"))
    return [0, 2];
  if (a === "thu" && b in THU && w[i + 2] !== "am" && w[i + 2] !== "pm")
    return [THU[b], 2];
  if (!(a in DAYS)) return null;
  // "thu vien" is a library, not Thursday: a bare thu before a plain word that means nothing else is a title word.
  if (
    a === "thu" &&
    b &&
    /^[a-z]{2,}$/.test(b) &&
    !JOIN.has(b) &&
    !read(w, raw, i + 1, false)
  )
    return null;
  return [DAYS[a], 1];
}
/** Words after a weekday that say next week: "tuan sau", "tuan toi", "next week"; 0 when absent. */
const nextWeekAt = (w: string[], i: number) =>
  (w[i] === "tuan" && (w[i + 1] === "sau" || w[i + 1] === "toi")) ||
  (w[i] === "next" && w[i + 1] === "week")
    ? 2
    : 0;
/** That weekday in the week after this one (weeks start on Monday). */
const weekOfNext = (dow: number, now: Date) =>
  addDays(startOfWeek(now, { weekStartsOn: 1 }), 7 + ((dow + 6) % 7));

/** "every mon", "moi ngay", "hang tuan", "daily" at w[i] as [rule, words]. "moi" with a mark ("mới") means new, not every. */
function repeatAt(
  w: string[],
  raw: string[],
  i: number,
): [Repeat, number] | null {
  const a = w[i];
  const b = w[i + 1];
  if (a === "daily") return [{ freq: "DAILY" }, 1];
  if (a === "weekly") return [{ freq: "WEEKLY" }, 1];
  if (
    !["every", "each", "moi", "hang"].includes(a) ||
    (a === "moi" && raw[i] === "mới")
  )
    return null;
  if (b === "day" || b === "ngay") return [{ freq: "DAILY" }, 2];
  if (b === "week" || b === "tuan") {
    // "hang tuan t4": the weekday after it is the day, not an end date.
    const wd = weekdayAt(w, raw, i + 2);
    return wd
      ? [{ freq: "WEEKLY", days: [wd[0]] }, 2 + wd[1]]
      : [{ freq: "WEEKLY" }, 2];
  }
  // "every mon tue", "moi t2 va t3": a run of weekdays, commas already stripped from the words.
  const days: number[] = [];
  let used = 1;
  for (;;) {
    const sep = days.length && ["and", "va", "&"].includes(w[i + used]) ? 1 : 0;
    const wd = weekdayAt(w, raw, i + used + sep);
    if (!wd) break;
    days.push(wd[0]);
    used += sep + wd[1];
  }
  return days.length
    ? [{ freq: "WEEKLY", days: [...new Set(days)] }, used]
    : null;
}
const SPLIT_UNIT = new Set([
  "block",
  "blocks",
  "part",
  "parts",
  "chunk",
  "chunks",
  "piece",
  "pieces",
  "session",
  "sessions",
]);
const VI_SPLIT_UNIT = new Set(["buoi", "phan", "lan", "khoan"]);

/** What one word (or several) means, from closed lists. Null when it is just part of the title. */
function read(
  w: string[],
  raw: string[],
  i: number,
  afterAt: boolean,
): Read | null {
  const a = w[i];
  const b = w[i + 1];
  let m: RegExpExecArray | null;
  const n = num(w, i, raw);
  // "chia 2 buoi", "in 3 blocks", "split into 2": cut a long task into that many blocks.
  const sp =
    a === "chia"
      ? b === "thanh" || b === "lam"
        ? 2
        : 1
      : a === "in"
        ? 1
        : a === "split"
          ? b === "into"
            ? 2
            : 1
          : 0;
  const sn = sp ? num(w, i + sp, raw) : null;
  if (sn && Number.isInteger(sn[0]) && sn[0] >= 2) {
    const unit = w[i + sp + sn[1]];
    const more = (a === "chia" ? VI_SPLIT_UNIT : SPLIT_UNIT).has(unit) ? 1 : 0;
    if (more || a === "split" || a === "chia")
      return {
        used: sp + sn[1] + more,
        kind: "split",
        apply: (u) => void (u.split = Math.min(MAX_SPLIT_CHUNKS, sn[0])),
      };
  }
  const rp = repeatAt(w, raw, i);
  if (rp)
    return {
      used: rp[1],
      kind: "repeat",
      apply: (u) => void (u.repeat = rp[0]),
    };
  if (n) {
    const [v, k] = n;
    const u = w[i + k];
    const j = i + k + 1;
    const whole = Number.isInteger(v);
    if (u === "gio" && whole && v < 24) {
      // "7 gio 30", "7 gio ruoi", "7 gio kem 15", "7 gio toi" and "at 7 gio" are clocks; "2 gio" alone is a length.
      let h = v;
      let mins: number | null = null;
      let used = k + 1;
      const km = w[j] === "kem" ? num(w, j + 1) : null;
      if (km && Number.isInteger(km[0]) && km[0] >= 1 && km[0] < 60 && v >= 1) {
        h = v - 1;
        mins = 60 - km[0];
        used += 1 + km[1];
      } else if (isHalf(w[j])) {
        mins = 30;
        used++;
      } else if (/^\d{1,2}$/.test(w[j] ?? "") && +w[j] < 60) {
        if (MIN_UNIT.has(w[j + 1])) return len(v * 60 + +w[j], k + 3);
        mins = +w[j];
        used++;
      }
      const part = w[i + used] in CLOCK_PART ? w[i + used] : undefined;
      if (mins !== null || part || afterAt || v >= 13)
        return clock(withPart(h, part), mins ?? 0, used + (part ? 1 : 0));
    }
    if (
      u === "thang" &&
      whole &&
      v >= 1 &&
      v <= 31 &&
      /^\d{1,2}$/.test(w[j] ?? "") &&
      +w[j] >= 1 &&
      +w[j] <= 12
    )
      return day(k + 2, (now) => {
        const at = (y: number) => new Date(y, +w[j] - 1, v);
        const d = at(now.getFullYear());
        return d < startOfDay(now) ? at(now.getFullYear() + 1) : d;
      });
    if (SPLIT_UNIT.has(u) && whole && v >= 2)
      return {
        used: k + 1,
        kind: "split",
        apply: (x) => void (x.split = Math.min(MAX_SPLIT_CHUNKS, v)),
      };
    if (HOUR_UNIT.has(u))
      return len(
        Math.round(v * 60) + (whole && isHalf(w[j]) ? 30 : 0),
        k + 1 + (whole && isHalf(w[j]) ? 1 : 0),
      );
    if (MIN_UNIT.has(u)) return len(Math.round(v), k + 1);
    if ((u === "am" || u === "pm") && whole && v >= 1 && v <= 12)
      return clock((v % 12) + (u === "pm" ? 12 : 0), 0, k + 1);
    if (u in PARTS && whole && v >= 1 && v <= 12)
      return clock(withPart(v, u), 0, k + 1);
  }
  if (a === "nua" && HOUR_UNIT.has(b)) return len(30, 2);
  if (a === "tieng" && isHalf(b)) return len(90, 2);
  if (a === "next" && b === "week" && !weekdayAt(w, raw, i + 2))
    return day(2, (now) => addDays(startOfDay(now), 7));
  if (a === "tuan" && (b === "sau" || b === "toi") && !weekdayAt(w, raw, i + 2))
    return day(2, (now) => addDays(startOfDay(now), 7));
  if (a === "tuan" && b === "nay") return day(2, (now) => nextDay(0, now));
  if (a === "cuoi" && b === "tuan") return day(2, (now) => nextDay(6, now));
  const wd = weekdayAt(w, raw, i);
  if (wd) {
    // "t2 hang tuan", "fri weekly": that weekday, every week.
    const rw = repeatAt(w, raw, i + wd[1]);
    if (rw && rw[0].freq === "WEEKLY" && !rw[0].days)
      return {
        used: wd[1] + rw[1],
        kind: "repeat",
        apply: (x) => void (x.repeat = { freq: "WEEKLY", days: [wd[0]] }),
      };
    const nw = nextWeekAt(w, i + wd[1]);
    return nw
      ? day(wd[1] + nw, (now) => weekOfNext(wd[0], now))
      : day(wd[1], (now) => nextDay(wd[0], now));
  }
  // "tuan sau t2", "next fri": the weekday of next week.
  const pre = nextWeekAt(w, i) || (a === "next" ? 1 : 0);
  const wp = pre ? weekdayAt(w, raw, i + pre) : null;
  if (wp) return day(pre + wp[1], (now) => weekOfNext(wp[0], now));
  // "thang 12": the end of that month, or the day before it starts after "truoc".
  if (a === "thang" && /^\d{1,2}$/.test(b ?? "") && +b >= 1 && +b <= 12) {
    const before = ["truoc", "before", "by"].includes(w[i - 1]);
    return day(2, (now) => {
      const at = (y: number) =>
        before ? new Date(y, +b - 1, 0) : new Date(y, +b, 0);
      const d = at(now.getFullYear());
      return d < startOfDay(now) ? at(now.getFullYear() + 1) : d;
    });
  }
  if (a === "bua" && b === "mai")
    return day(2, (now) => addDays(startOfDay(now), 1));
  if ((a === "hom" || a === "bua") && b === "nay")
    return day(2, (now) => startOfDay(now));
  if (a === "ngay" && b === "mai")
    return day(2, (now) => addDays(startOfDay(now), 1));
  if (a === "ngay" && b === "mot")
    return day(2, (now) => addDays(startOfDay(now), 2));
  if (a === "ngay" && b === "kia")
    return day(2, (now) => addDays(startOfDay(now), 3));
  if ((m = /^(\d{1,2})(?::(\d{2}))?(am|pm)$/.exec(a))) {
    const h = (+m[1] % 12) + (m[3] === "pm" ? 12 : 0);
    return m[1] === "0" || +m[1] > 12 ? null : clock(h, m[2] ? +m[2] : 0);
  }
  if ((m = /^(\d{1,2}):(\d{2})$/.exec(a))) return clock(+m[1], +m[2]);
  if ((m = /^(\d{1,2})[hg](\d{2})?$/.exec(a))) {
    // 14h, "at 7h" and "7h toi" are clocks; 2h and 1h30 are lengths.
    const part = b in CLOCK_PART ? b : undefined;
    if (+m[1] >= 13 || afterAt || part || a.includes("g"))
      return clock(withPart(+m[1], part), m[2] ? +m[2] : 0, part ? 2 : 1);
    return len(+m[1] * 60 + (m[2] ? +m[2] : 0));
  }
  if ((m = /^(\d{1,3})(?:m|p|ph|min|mins|phut)$/.exec(a))) return len(+m[1]);
  if ((m = /^(\d{1,2}(?:[.,]5)?)(?:hr|hrs|hour|hours|gio|tieng)$/.exec(a)))
    return len(Math.round(parseFloat(m[1].replace(",", ".")) * 60));
  if (TODAY.has(a)) return day(1, (now) => startOfDay(now));
  if (TOMORROW.has(a)) return day(1, (now) => addDays(startOfDay(now), 1));
  if (
    (m = /^(\d{1,2})[/-](\d{1,2})$/.exec(a)) &&
    +m[1] >= 1 &&
    +m[1] <= 31 &&
    +m[2] >= 1 &&
    +m[2] <= 12
  )
    return day(1, (now) => {
      const d = new Date(now.getFullYear(), +m![2] - 1, +m![1]);
      return d < startOfDay(now)
        ? new Date(now.getFullYear() + 1, +m![2] - 1, +m![1])
        : d;
    });
  if (a in PARTS)
    return { used: 1, kind: "part", apply: (u) => void (u.window = PARTS[a]) };
  return null;
}

/**
 * Cheap reading of one line: closed word lists and a few patterns, anywhere in the line, English and Vietnamese.
 * First hit of each kind wins. A line that is nothing but these words keeps them as its title.
 */
export function understand(
  line: string,
  now: Date,
  skip?: ReadonlySet<string>,
): Understood {
  const out: Understood = { title: line.trim(), spans: [] };
  const words = [...line.matchAll(/\S+/g)].map((m) => ({
    text: canon(
      fold(m[0])
        .text.replace(/[.,;!?]+$/, "")
        .replace(/^([ap])\.m$/, "$1m"),
    ),
    raw: m[0].toLowerCase(),
    start: m.index!,
    end: m.index! + m[0].length,
  }));
  const w = words.map((x) => x.text);
  const raw = words.map((x) => x.raw);
  const seen = new Set<SpanKind>();
  const cut: [number, number][] = [];
  const stops = (k: number) =>
    !!read(w, raw, k, false) ||
    JOIN.has(w[k]) ||
    fromLen(w, k) > 0 ||
    PLACE.has(w[k]) ||
    words[k].raw === "ở";
  let fromAt = -1;
  for (let i = 0; i < words.length; i++) {
    const inFrom = fromAt >= 0;
    const fl = fromLen(w, i);
    if (!inFrom && fl && !seen.has("from") && !skip?.has(w[i])) {
      const nx = read(w, raw, i + fl, true);
      if (nx && (nx.kind === "day" || nx.kind === "clock")) {
        fromAt = i;
        i += fl - 1;
        continue;
      }
    }
    if (
      !seen.has("place") &&
      !skip?.has(w[i]) &&
      (PLACE.has(w[i]) || words[i].raw === "ở") &&
      i + 1 < words.length &&
      !stops(i + 1)
    ) {
      let to = i + 1;
      while (to + 1 < words.length && to - i < 3 && !stops(to + 1)) to++;
      seen.add("place");
      out.place = line.slice(words[i + 1].start, words[to].end);
      out.spans.push({
        start: words[i].start,
        end: words[to].end,
        kind: "place",
        word: w[i],
      });
      cut.push([words[i].start, words[to].end]);
      i = to;
      continue;
    }
    const hit = skip?.has(w[i])
      ? null
      : read(w, raw, i, inFrom || (i > 0 && AT.has(w[i - 1])));
    if (inFrom && hit && (hit.kind === "day" || hit.kind === "clock")) {
      const tmp: Understood = { title: "", spans: [] };
      hit.apply(tmp, now);
      out.from = {
        ...out.from,
        ...(tmp.day ? { day: tmp.day } : {}),
        ...(tmp.time != null ? { time: tmp.time } : {}),
      };
      const to = i + hit.used - 1;
      const last = out.spans[out.spans.length - 1];
      if (last?.kind === "from") {
        last.end = words[to].end;
        cut[cut.length - 1][1] = words[to].end;
      } else {
        out.spans.push({
          start: words[fromAt].start,
          end: words[to].end,
          kind: "from",
          word: w[fromAt],
        });
        cut.push([words[fromAt].start, words[to].end]);
        seen.add("from");
      }
      i = to;
      continue;
    }
    fromAt = -1;
    if (!hit) continue;
    if (seen.has(hit.kind)) {
      // A second length or day is ignored, but its words are not read again as something else.
      i += hit.used - 1;
      continue;
    }
    seen.add(hit.kind);
    hit.apply(out, now);
    let from = i;
    if (
      i > 0 &&
      JOIN.has(w[i - 1]) &&
      !cut.some(([, e]) => e >= words[i - 1].end)
    )
      from = i - 1;
    const to = i + hit.used - 1;
    out.spans.push({
      start: words[from].start,
      end: words[to].end,
      kind: hit.kind,
      word: w[i],
    });
    cut.push([words[from].start, words[to].end]);
    i = to;
  }
  const title = [...line]
    .reduce(
      (s, ch, k) => (cut.some(([a, b]) => k >= a && k < b) ? s : s + ch),
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return { title: line.trim(), spans: [] };
  out.title = title;
  return out;
}

/** The deadline a line asks for: its day (today when only a time is given), at its time or the end of the day. */
export function deadlineOf(u: Understood, now: Date): Date | undefined {
  if (!u.day && u.time == null) return undefined;
  const day = u.day ?? startOfDay(now);
  if (u.time == null) return new Date(addDays(day, 1).getTime() - 1);
  const at = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(u.time / 60),
    u.time % 60,
  );
  return !u.day && at <= now ? addDays(at, 1) : at;
}

const RRULE_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAILY_DAYS = 7;
const WEEKLY_DAYS = 28;

/** Where a repeat stops: its day (a clock time with a repeat is the series time, not the end), end of that day. */
export const repeatEnd = (u: Understood): Date | undefined =>
  u.day ? new Date(addDays(startOfDay(u.day), 1).getTime() - 1) : undefined;

/**
 * What "every mon, tue" or "moi ngay" turns into. A start ("after fri") and an end (the line's day) bound it.
 * With a clock time it is a fixed series from the first occurrence; without one, a flexible task per
 * occurrence, each due that day (a week of days or four weeks by default).
 */
export function repeatOf(
  u: Understood,
  now: Date,
):
  | { rrule: string; start?: Date; deadlines: Date[] }
  | undefined {
  if (!u.repeat) return undefined;
  const today = startOfDay(now);
  const daily = u.repeat.freq === "DAILY";
  const days = u.repeat.days ?? [(u.from?.day ?? today).getDay()];
  const floor = notBeforeOf(u, now) ?? now;
  const until = repeatEnd(u);
  const last = until ?? addDays(today, daily ? DAILY_DAYS : WEEKLY_DAYS);
  const at = (d: Date) =>
    new Date(
      d.getFullYear(),
      d.getMonth(),
      d.getDate(),
      Math.floor((u.time ?? 0) / 60),
      (u.time ?? 0) % 60,
    );
  const rrule = daily
    ? "FREQ=DAILY"
    : `FREQ=WEEKLY;BYDAY=${days.map((d) => RRULE_DAY[d]).join(",")}`;
  const dates: Date[] = [];
  for (
    let d = startOfDay(floor);
    d < last && dates.length < MAX_BULK_SESSIONS;
    d = addDays(d, 1)
  ) {
    if (!daily && !days.includes(d.getDay())) continue;
    if ((u.time != null ? at(d) : addDays(d, 1)) > floor) dates.push(d);
  }
  if (u.time != null)
    return {
      rrule: until
        ? `${rrule};UNTIL=${until.toISOString().replace(/[-:]|\.\d{3}/g, "")}`
        : rrule,
      start: dates[0] && at(dates[0]),
      deadlines: [],
    };
  return {
    rrule,
    deadlines: dates.map((d) => new Date(addDays(d, 1).getTime() - 1)),
  };
}

/** The earliest start a line asks for ("after fri", "no sooner than 3pm"), or undefined when it is past or not stated. */
export function notBeforeOf(u: Understood, now: Date): Date | undefined {
  if (!u.from) return undefined;
  const d = u.from.day ?? startOfDay(now);
  const m = u.from.time ?? 0;
  const at = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    Math.floor(m / 60),
    m % 60,
  );
  return at > now ? at : undefined;
}

/** A change to apply to every picked task from what was typed, or null when nothing was read. */
export function editFrom(
  u: Understood,
): ((s: Session, now: Date) => UpdateSessionInput) | null {
  if (!u.minutes && !u.day && u.time == null && !u.window) return null;
  return (s, now) => {
    const patch: UpdateSessionInput = {};
    if (u.minutes) patch.durationMinutes = u.minutes;
    if (u.window) patch.window = u.window;
    if (u.day || u.time != null) {
      const cur = new Date(s.scheduledStartTime ?? now);
      const day = u.day ?? cur;
      const mins = u.time ?? cur.getHours() * 60 + cur.getMinutes();
      patch.scheduledStartTime = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        Math.floor(mins / 60),
        mins % 60,
      ).toISOString();
    }
    return patch;
  };
}
