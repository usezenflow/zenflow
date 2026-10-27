import { insightText } from "@/lib/palette/insights";
import { Text } from "@/components/ui/text";
import { format, t, weekdayShort } from "@/lib/i18n";
import { paletteColors } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { SESSION_TONES, SESSION_TYPE_TONE } from "@zenflow/core";
import type {
  RecapResponse,
  ReplanPreview,
  SessionType,
} from "@zenflow/shared";
import {
  addDays,
  differenceInCalendarDays,
  differenceInCalendarWeeks,
  startOfWeek,
} from "date-fns";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import Svg, {
  Circle,
  Defs,
  G,
  Line,
  LinearGradient,
  Path,
  Pattern,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";

const TYPES: SessionType[] = ["LECTURE", "ASSIGNMENT", "EXAM", "TASK", "DND"];
const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: "Class",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  TASK: "Task",
  DND: "Busy",
};
const typeColor = (type: string) =>
  SESSION_TONES[SESSION_TYPE_TONE[type as SessionType] ?? "dnd"].base;
const heat = (r: number) =>
  r <= 0 ? 0 : r < 0.25 ? 0.2 : r < 0.5 ? 0.4 : r < 0.75 ? 0.6 : 0.85;
const h1 = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;

export function ChartCard({
  title,
  right,
  children,
}: {
  title: string;
  right?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      className="mx-4 mt-3 rounded-[24px] border border-border bg-card p-4"
      style={{
        shadowColor: "#2A2218",
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <View className="mb-3 flex-row items-baseline justify-between">
        <Text className="text-[15px] font-bold">{title}</Text>
        {right ? (
          <Text className="text-[12px] text-muted-foreground">{right}</Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** One stacked bar per day on a faint full height track, each type its own rounded block, with an 8 hour guide. */
export function DayBars({ recap }: { recap: RecapResponse }) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const ink = isDarkColorScheme ? "#B8AFA3" : "#6F665B";
  const [width, setWidth] = useState(300);
  const n = recap.days.length;
  const H = 240;
  const base = 200;
  const maxH = Math.max(8, ...recap.days.map((d) => d.busyMinutes / 60));
  const per = Math.min(16, 150 / maxH);
  // Measured width, so each column is an equal share of the card and the bar fills most of it.
  const step = width / Math.max(1, n);
  const bw = Math.min(44, Math.max(18, step * 0.72));
  const heaviest = recap.totals.busiestDay?.date;
  const guideY = base - 8 * per;
  return (
    <ChartCard
      title={t("Busy hours per day")}
      right={
        heaviest
          ? t("{day} heaviest", {
              day: weekdayShort(new Date(`${heaviest}T12:00:00`)),
            })
          : undefined
      }
    >
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
        <Svg width={width} height={H}>
          {recap.days.map((d, i) => (
            <Rect
              key={`t${d.date}`}
              x={i * step + (step - bw) / 2}
              y={base - 150}
              width={bw}
              height={150}
              rx={bw / 2.6}
              fill={c.orange}
              opacity={isDarkColorScheme ? 0.1 : 0.07}
            />
          ))}
          <Line
            x1={0}
            x2={width}
            y1={guideY}
            y2={guideY}
            stroke={c.danger}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.6}
          />
          <SvgText
            x={width}
            y={guideY - 4}
            textAnchor="end"
            fontSize={9.5}
            fill={c.danger}
            opacity={0.85}
          >
            {t("8h per day")}
          </SvgText>
          {recap.days.map((d, i) => {
            const x = i * step + (step - bw) / 2;
            let y = base;
            const peak = d.date === heaviest;
            return (
              <G key={d.date}>
                {TYPES.filter((ty) => d.minutesByType[ty]).map((ty) => {
                  const h = Math.max(5, (d.minutesByType[ty] / 60) * per - 1.5);
                  y -= h + 1.5;
                  return (
                    <Rect
                      key={ty}
                      x={x}
                      y={y}
                      width={bw}
                      height={h}
                      rx={bw / 3.2}
                      fill={typeColor(ty)}
                    />
                  );
                })}
                {d.busyMinutes > 0 && (
                  <SvgText
                    x={x + bw / 2}
                    y={y - 6}
                    textAnchor="middle"
                    fontSize={12}
                    fontWeight={peak ? "800" : "600"}
                    fill={peak ? c.orange : ink}
                  >
                    {h1(d.busyMinutes)}
                  </SvgText>
                )}
                <SvgText
                  x={x + bw / 2}
                  y={226}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight="600"
                  fill={ink}
                >
                  {weekdayShort(new Date(`${d.date}T12:00:00`))}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>
    </ChartCard>
  );
}

/** Busy minutes by weekday and hour, sunrise orange over the muted track. */
export function HourHeat({ recap }: { recap: RecapResponse }) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const from = 7;
  const to = 22;
  const cols = Array.from({ length: to - from }, (_, i) => from + i);
  const byHour = cols.map((h) =>
    recap.hourHeat.reduce((n, row) => n + (row[h] ?? 0), 0),
  );
  const best = byHour.indexOf(Math.max(...byHour));
  const weekdays = recap.days.map((d) =>
    weekdayShort(new Date(`${d.date}T12:00:00`)),
  );
  return (
    <ChartCard
      title={t("Your busy hours")}
      right={
        Math.max(...byHour) > 0
          ? t("Peak {a} to {b}", { a: cols[best], b: cols[best] + 2 })
          : undefined
      }
    >
      {recap.hourHeat.slice(0, 7).map((row, r) => (
        <View
          key={r}
          className="mb-[3px] flex-row items-center"
          style={{ gap: 3 }}
        >
          <Text
            className="w-6 text-[10.5px] font-semibold text-muted-foreground"
            numberOfLines={1}
          >
            {weekdays[r] ?? ""}
          </Text>
          {cols.map((h) => (
            <View
              key={h}
              className="h-[14px] flex-1 overflow-hidden rounded-[3px] bg-muted"
            >
              <View
                className="size-full"
                style={{
                  backgroundColor: c.orange,
                  opacity: heat((row[h] ?? 0) / 60),
                }}
              />
            </View>
          ))}
        </View>
      ))}
      <View className="flex-row pl-[27px]" style={{ gap: 3 }}>
        {cols.map((h) => (
          <Text
            key={h}
            className="flex-1 text-[9px] text-muted-foreground"
            numberOfLines={1}
          >
            {[7, 11, 15, 19, 22].includes(h) ? String(h).padStart(2, "0") : ""}
          </Text>
        ))}
      </View>
    </ChartCard>
  );
}

/** Donut of hours by type with a legend. */
export function TypeDonut({ recap }: { recap: RecapResponse }) {
  const rows = TYPES.map(
    (ty) => [ty, recap.totals.hoursByType[ty] ?? 0] as const,
  ).filter(([, v]) => v > 0);
  const total = rows.reduce((n, [, v]) => n + v, 0);
  const R = 40;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <ChartCard title={t("Hours by type")}>
      <View className="flex-row items-center gap-4">
        <View style={{ width: 104, height: 104 }}>
          <Svg width={104} height={104} viewBox="0 0 100 100">
            {rows.map(([ty, v]) => {
              const len = (v / total) * C;
              const el = (
                <Circle
                  key={ty}
                  cx={50}
                  cy={50}
                  r={R}
                  stroke={typeColor(ty)}
                  strokeWidth={13}
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={`${Math.max(0.1, len - 2.5)} ${C}`}
                  strokeDashoffset={-acc}
                  rotation={-90}
                  origin="50,50"
                />
              );
              acc += len;
              return el;
            })}
          </Svg>
          <View className="absolute inset-0 items-center justify-center">
            <Text className="text-[22px] font-extrabold leading-none">{`${Math.round(total)}h`}</Text>
            <Text className="mt-0.5 text-[10px] text-muted-foreground">
              {t("total")}
            </Text>
          </View>
        </View>
        <View className="flex-1" style={{ gap: 6 }}>
          {rows.map(([ty, v]) => (
            <View key={ty} className="flex-row items-center gap-2">
              <View
                className="size-2.5 rounded-full"
                style={{ backgroundColor: typeColor(ty) }}
              />
              <Text className="flex-1 text-[12.5px]">{t(TYPE_LABEL[ty])}</Text>
              <Text className="text-[12.5px] font-semibold">{`${Math.round(v * 10) / 10}h`}</Text>
            </View>
          ))}
        </View>
      </View>
    </ChartCard>
  );
}

/** How much time is left before each deadline: red unplaced, amber tight, green roomy. */
export function SlackBars({ recap }: { recap: RecapResponse }) {
  const c = paletteColors(useColorScheme().isDarkColorScheme);
  if (!recap.deadlines.length) return null;
  const left = (m: number) =>
    m >= 24 * 60
      ? `${Math.floor(m / 1440)} ${t("d")} ${Math.round((m % 1440) / 60)}h`
      : h1(m);
  return (
    <ChartCard
      title={t("Time left before deadlines")}
      right={t("{n} deadlines", { n: recap.deadlines.length })}
    >
      <View style={{ gap: 12 }}>
        {recap.deadlines.map((d, i) => {
          const slack = d.slackMinutes ?? 0;
          const color =
            !d.placed || slack < 12 * 60
              ? c.danger
              : slack < 48 * 60
                ? c.yellow
                : c.success;
          const ratio = d.placed
            ? Math.min(1, Math.max(0.04, slack / (72 * 60)))
            : 0.03;
          return (
            <View key={`${i}-${d.title}`}>
              <View className="mb-1 flex-row items-baseline justify-between">
                <Text
                  className="min-w-0 flex-1 text-[12.5px] font-medium"
                  numberOfLines={1}
                >
                  {d.title}
                </Text>
                <Text
                  className="ml-2 text-[12.5px] font-semibold"
                  style={{ color }}
                >
                  {d.placed ? left(slack) : t("Not placed")}
                </Text>
              </View>
              <View className="h-2.5 rounded-full bg-muted">
                <View
                  className="h-full rounded-full"
                  style={{ width: `${ratio * 100}%`, backgroundColor: color }}
                />
                <View className="absolute -top-1 right-0 size-[18px] items-center justify-center rounded-full border border-border bg-card">
                  <Svg width={10} height={10} viewBox="0 0 32 32" fill="none">
                    <Path
                      d="M5 21a11 11 0 0 1 22 0"
                      stroke="#FF8E3E"
                      strokeWidth={4}
                      strokeLinecap="round"
                    />
                  </Svg>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </ChartCard>
  );
}

export function InsightChips({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <ChartCard title={t("Worth noting")}>
      <View className="flex-row flex-wrap" style={{ gap: 8 }}>
        {lines.map((l, i) => (
          <View
            key={`${i}-${l}`}
            className="max-w-full flex-row items-center rounded-[16px] border border-border px-3 py-1.5"
          >
            <View className="mr-2 size-1.5 rounded-full bg-primary" />
            <Text className="shrink text-[13.5px]">{insightText(l)}</Text>
          </View>
        ))}
      </View>
    </ChartCard>
  );
}

const HOUR_FROM = 8;
const HOUR_TO = 22;
const COL = 50;
const GAP = 6;
const LEFT = 30;
const TOP = 56;
const H = 213;
const SEAM = 100;
const SVG_H = TOP + H + 20;
const BLOCK = (90 / 60 / (HOUR_TO - HOUR_FROM)) * H;
const RED = "#E5484D";
const MOVE_HUES = ["#FF8E3E", "#3FB5A8", "#8E7CF0", "#E5609A", "#4FA0F0", "#9CC43A"];

/** One hue per move, shared by its ghost, curve, block and list card, so a curve can be followed by color. */
export const moveColor = (i: number) => MOVE_HUES[i % MOVE_HUES.length];

const WEEK = { weekStartsOn: 1 } as const;
/** Week of `d` counted from the week of `from` (0 is the viewed week). */
export const weekOffset = (d: Date, from: Date) =>
  differenceInCalendarWeeks(d, from, WEEK);

/**
 * Before and after, as in the mockup: the viewed week shows all seven days, other weeks only the days that
 * change (hatched), a red seam with a Previous or Next week badge between them. One wide chart, swipe sideways.
 * A dashed ghost marks where a task was, a solid block where it lands, a curve of the move's color joins them.
 * The preview carries no length, so every block is drawn 90 minutes tall.
 */
export function ReplanDiff({
  preview,
  from,
}: {
  preview: ReplanPreview;
  from: Date;
  to?: Date;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const [page, setPage] = useState(0);
  const ink = isDarkColorScheme ? "#B8AFA3" : "#6F665B";
  const first = startOfWeek(from, WEEK);
  const dayIdx = (d: Date) => differenceInCalendarDays(d, first);
  const touched = [
    ...new Set(
      preview.moves.flatMap((m) => [
        dayIdx(new Date(m.from)),
        dayIdx(new Date(m.to)),
      ]),
    ),
  ].sort((a, b) => a - b);
  const weeks = [
    ...new Set([0, ...touched.map((k) => Math.floor(k / 7))]),
  ].sort((a, b) => a - b);
  const groups = weeks.map((w) => ({
    w,
    days:
      w === 0
        ? Array.from({ length: 7 }, (_, i) => i)
        : touched.filter((k) => Math.floor(k / 7) === w),
  }));
  const xOf = new Map<number, number>();
  const spans: { w: number; x0: number; x1: number }[] = [];
  let cursor = LEFT;
  for (const g of groups) {
    const x0 = cursor;
    for (const k of g.days) {
      xOf.set(k, cursor);
      cursor += COL + GAP;
    }
    spans.push({ w: g.w, x0, x1: cursor - GAP });
    cursor += SEAM - GAP;
  }
  const width = cursor - SEAM + GAP + 4;
  const y = (d: Date) =>
    TOP +
    Math.min(
      H,
      Math.max(
        0,
        ((d.getHours() + d.getMinutes() / 60 - HOUR_FROM) /
          (HOUR_TO - HOUR_FROM)) *
          H,
      ),
    );
  const hourY = (h: number) => y(new Date(2000, 0, 1, h));
  const colX = (d: Date) => xOf.get(dayIdx(d)) as number;
  const viewed = Math.max(0, weeks.indexOf(0));
  return (
    <View
      testID="replan-diff"
      className="mx-4 mt-3 rounded-[26px] border border-border bg-card p-3"
      style={{
        shadowColor: "#2A2218",
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-[15px] font-bold">{t("Before and after")}</Text>
        <View className="flex-row items-center" style={{ gap: 12 }}>
          <View className="flex-row items-center">
            <View className="mr-1 h-2.5 w-4 rounded-sm border border-dashed border-foreground/50" />
            <Text className="text-[11.5px] text-muted-foreground">
              {t("Old")}
            </Text>
          </View>
          <View className="flex-row items-center">
            <View
              className="mr-1 h-2.5 w-4 rounded-sm"
              style={{ backgroundColor: c.orange }}
            />
            <Text className="text-[11.5px] text-muted-foreground">
              {t("New")}
            </Text>
          </View>
        </View>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: Math.max(0, spans[viewed].x0 - LEFT), y: 0 }}
        scrollEventThrottle={64}
        onScroll={(e) => {
          const x = e.nativeEvent.contentOffset.x + LEFT;
          const i = spans.findLastIndex((s) => x >= s.x0 - SEAM / 2);
          setPage(Math.max(0, i));
        }}
      >
        <Svg width={width} height={SVG_H} viewBox={`0 0 ${width} ${SVG_H}`}>
          <Defs>
            <Pattern
              id="hatch"
              patternUnits="userSpaceOnUse"
              width={9}
              height={9}
              patternTransform="rotate(135)"
            >
              <Rect width={9} height={9} fill={c.orange} opacity={0.07} />
              <Rect width={4} height={9} fill={c.orange} opacity={0.22} />
            </Pattern>
            <LinearGradient id="seam" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={RED} stopOpacity={0} />
              <Stop offset="0.18" stopColor={RED} />
              <Stop offset="0.82" stopColor={RED} />
              <Stop offset="1" stopColor={RED} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="seamglow" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0" stopColor={RED} stopOpacity={0} />
              <Stop offset="0.5" stopColor={RED} stopOpacity={0.22} />
              <Stop offset="1" stopColor={RED} stopOpacity={0} />
            </LinearGradient>
            <LinearGradient id="seambadge" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor="#F2603A" />
              <Stop offset="1" stopColor="#D8264A" />
            </LinearGradient>
          </Defs>
          {groups.flatMap((g) =>
            g.days.map((k) => {
              const d = addDays(first, k);
              const x = xOf.get(k) as number;
              const weekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <G key={k}>
                  <Rect
                    x={x}
                    y={TOP}
                    width={COL}
                    height={H}
                    rx={9}
                    fill={
                      g.w === 0
                        ? isDarkColorScheme
                          ? "#2C2822"
                          : "#EFEAE3"
                        : "url(#hatch)"
                    }
                    opacity={g.w === 0 ? (weekend ? 0.3 : 0.55) : 1}
                    stroke={g.w === 0 ? undefined : c.orange}
                    strokeOpacity={0.55}
                    strokeDasharray="3 3"
                  />
                  <SvgText
                    x={x + COL / 2}
                    y={TOP - 24}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight="600"
                    fill={ink}
                  >
                    {weekdayShort(d)}
                  </SvgText>
                  <SvgText
                    x={x + COL / 2}
                    y={TOP - 11}
                    textAnchor="middle"
                    fontSize={8.5}
                    fill={ink}
                  >{`${d.getDate()}/${d.getMonth() + 1}`}</SvgText>
                </G>
              );
            }),
          )}
          {spans.map((s) => (
            <G key={`wk${s.w}`}>
              <Rect
                x={s.x0}
                y={2}
                width={Math.max(58, s.x1 - s.x0)}
                height={16}
                rx={8}
                fill={s.w === 0 ? c.orange : RED}
                opacity={s.w === 0 ? 0.18 : 0.14}
              />
              <SvgText
                x={s.x0 + 10}
                y={13}
                fontSize={9}
                fontWeight="700"
                fill={s.w === 0 ? c.orange : RED}
              >{`${t("Week")} ${format(addDays(first, s.w * 7), "d/M")}`}</SvgText>
            </G>
          ))}
          {[8, 12, 16, 20].map((h) => (
            <G key={h}>
              <SvgText
                x={2}
                y={hourY(h) + 3}
                fontSize={9}
                fill={ink}
              >{`${String(h).padStart(2, "0")}h`}</SvgText>
              <Line
                x1={LEFT}
                x2={width - 4}
                y1={hourY(h)}
                y2={hourY(h)}
                stroke={ink}
                strokeWidth={0.7}
                strokeDasharray="2 3"
                opacity={0.35}
              />
            </G>
          ))}
          {preview.moves.map((m, i) => {
            const a = new Date(m.from);
            const b = new Date(m.to);
            const col = moveColor(i);
            const ax = colX(a) + 3;
            const bx = colX(b) + 3;
            const ay = y(a);
            const by = y(b);
            const w = COL - 6;
            const sx = bx > ax ? ax + w : ax;
            const ex = bx > ax ? bx : bx + w;
            const mx = (sx + ex) / 2;
            const label = m.title.length > 7 ? `${m.title.slice(0, 6)}.` : m.title;
            return (
              <G key={m.id}>
                <Rect
                  x={ax}
                  y={ay}
                  width={w}
                  height={BLOCK}
                  rx={6}
                  fill="none"
                  stroke={col}
                  strokeWidth={1.3}
                  strokeDasharray="3 3"
                  opacity={0.8}
                />
                <Path
                  d={`M${sx} ${ay + BLOCK / 2} C${mx} ${ay + BLOCK / 2} ${mx} ${by + BLOCK / 2} ${ex} ${by + BLOCK / 2}`}
                  fill="none"
                  stroke={col}
                  strokeWidth={1.8}
                  strokeLinecap="round"
                />
                <Rect
                  x={bx}
                  y={by}
                  width={w}
                  height={BLOCK}
                  rx={6}
                  fill={col}
                  opacity={0.95}
                />
                <SvgText
                  x={bx + w / 2}
                  y={by + BLOCK / 2 + 3}
                  textAnchor="middle"
                  fontSize={9.5}
                  fontWeight="700"
                  fill="#fff"
                >
                  {label}
                </SvgText>
              </G>
            );
          })}
          {spans.slice(0, -1).map((s, i) => {
            const cx = s.x1 + SEAM / 2 - GAP / 2;
            const next = spans[i + 1].w > 0 && s.w >= 0;
            const label = next ? t("Next week") : t("Previous week");
            return (
              <G key={`seam${i}`}>
                <Rect x={cx - 10} y={TOP - 14} width={20} height={H + 28} rx={10} fill="url(#seamglow)" />
                <Rect x={cx - 1.5} y={TOP - 14} width={3} height={H + 28} rx={1.5} fill="url(#seam)" />
                <Circle cx={cx} cy={TOP - 14} r={3.5} fill={RED} />
                <Circle cx={cx} cy={TOP + H + 14} r={3.5} fill={RED} />
                <Rect x={cx - 44} y={TOP + H / 2 - 13} width={88} height={26} rx={13} fill="url(#seambadge)" stroke="#fff" strokeWidth={2} />
                <Path
                  d={next ? `M${cx + 33} ${TOP + H / 2 - 4} l4 4 l-4 4` : `M${cx - 33} ${TOP + H / 2 - 4} l-4 4 l4 4`}
                  fill="none"
                  stroke="#fff"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <SvgText
                  x={cx + (next ? -4 : 4)}
                  y={TOP + H / 2 + 4}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight="800"
                  fill="#fff"
                >
                  {label}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </ScrollView>
      {spans.length > 1 && (
        <View className="mt-1 flex-row justify-center" style={{ gap: 4 }}>
          {spans.map((s, i) => (
            <View
              key={s.w}
              className={`h-1 rounded-full ${i === page ? "w-4 bg-primary" : "w-1 bg-muted-foreground/40"}`}
            />
          ))}
        </View>
      )}
    </View>
  );
}
