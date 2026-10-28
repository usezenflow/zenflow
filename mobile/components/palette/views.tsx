import { listSessions } from "@/api/tasks";
import { ErrorMark, NoResultsMark } from "@/components/brand/state-marks";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { format, t } from "@/lib/i18n";
import { KIND_COLOR, paletteColors, tint } from "@/lib/palette/theme";
import { useColorScheme } from "@/lib/useColorScheme";
import { SESSION_TONES, SESSION_TYPE_TONE } from "@zenflow/core";
import type {
  FreeSlotsResponse,
  RecapResponse,
  ReplanChange,
  ReplanPreview,
  Session,
  SessionType,
} from "@zenflow/shared";
import {
  addDays,
  differenceInCalendarDays,
  isSameDay,
  startOfDay,
} from "date-fns";
import { useEffect, useState } from "react";
import { LinearGradient } from "expo-linear-gradient";
import { Pressable, ScrollView, View } from "react-native";
import Animated, {
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { CurveSwirl } from "@/components/ui/spinner";
import { selectOffline, useConnectivity } from "@/lib/connectivity";
import {
  DayBars,
  HourHeat,
  InsightChips,
  ReplanDiff,
  moveColor,
  weekOffset,
  SlackBars,
  TypeDonut,
} from "./charts";
import { Ico } from "./icons";
import { ResultPanel } from "./result-panel";

const hm = (d: Date) => format(d, "HH:mm");
export const hours = (minutes: number) =>
  `${Math.round((minutes / 60) * 10) / 10}h`;

/** Floating white card used by every result below the pill. */
function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <View
      className={`mx-4 mt-3 rounded-[24px] border border-border bg-card p-4 ${className}`}
      style={{
        shadowColor: "#2A2218",
        shadowOpacity: 0.14,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      {children}
    </View>
  );
}

/** Cancel and confirm pinned to the bottom of the screen. */
export function FooterBar({
  secondary,
  primary,
  onSecondary,
  onPrimary,
  disabled,
  busy,
}: {
  secondary: string;
  primary: string;
  onSecondary: () => void;
  onPrimary: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { isDarkColorScheme } = useColorScheme();
  return (
    <View className="absolute inset-x-0 bottom-0 z-10 flex-row gap-3 px-4 pb-8 pt-3">
      <Button
        testID="footer-secondary"
        variant="outline"
        className="h-14 flex-1 rounded-[20px] bg-card"
        onPress={onSecondary}
      >
        <Text className="text-[16px] font-semibold">{secondary}</Text>
      </Button>
      <Button
        testID="footer-primary"
        disabled={disabled || busy}
        className="h-14 flex-[2] rounded-[20px]"
        onPress={onPrimary}
      >
        {busy && (
          <View className="mr-2 size-5">
            <CurveSwirl color={paletteColors(isDarkColorScheme).ink} />
          </View>
        )}
        <Text className="text-[16px] font-semibold">{primary}</Text>
      </Button>
    </View>
  );
}

/** Broken mark in place of the results; the field keeps its text. */
export function FailedView({ onRetry }: { onRetry: () => void }) {
  return (
    <View testID="failed-view" className="items-center px-8 pt-24">
      <ErrorMark />
      <Text className="mt-5 text-[17px] font-bold">{t("Could not load")}</Text>
      <Text className="mt-1 text-center text-[13.5px] text-muted-foreground">
        {t("Check the connection and try again.")}
      </Text>
      <Button
        testID="retry"
        className="mt-5 rounded-2xl px-6"
        onPress={onRetry}
      >
        <Text>{t("Try again")}</Text>
      </Button>
    </View>
  );
}

export function EmptyView({ text }: { text: string }) {
  return (
    <View testID="empty-view" className="items-center px-8 pt-24">
      <NoResultsMark />
      <Text className="mt-5 text-[17px] font-bold">{text}</Text>
    </View>
  );
}

export function RecapView({
  recap,
  prev,
  from,
  to,
  onReplan,
  onFree,
}: {
  recap: RecapResponse;
  prev: RecapResponse | null;
  from: Date;
  to: Date;
  onReplan: () => void;
  onFree: () => void;
}) {
  const c = paletteColors(useColorScheme().isDarkColorScheme);
  const busy = recap.days.reduce((n, d) => n + d.busyMinutes, 0);
  const free = recap.days.reduce((n, d) => n + d.freeMinutes, 0);
  const before = prev ? prev.days.reduce((n, d) => n + d.busyMinutes, 0) : 0;
  const delta =
    before > 0 ? Math.round(((busy - before) / before) * 100) : null;
  const tiles: [string, string, boolean][] = [
    [hours(busy), t("Busy"), true],
    [hours(free), t("Free"), false],
    [String(recap.deadlines.length), t("Deadlines"), false],
  ];
  return (
    <View testID="recap-view">
      <View className="mx-6 mt-5 flex-row items-end justify-between">
        <View>
          <Text className="text-[13px] text-muted-foreground">{t("Week")}</Text>
          <Text className="text-[24px] font-bold">{`${format(from, "d/M")} ${t("to")} ${format(to, "d/M")}`}</Text>
        </View>
        {delta !== null && delta !== 0 && (
          <View className="rounded-full bg-primary/15 px-3 py-1.5">
            <Text
              className="text-[12.5px] font-semibold"
              style={{ color: c.warnInk }}
            >
              {delta > 0
                ? t("Heavier than last week {n}%", { n: delta })
                : t("Lighter than last week {n}%", { n: -delta })}
            </Text>
          </View>
        )}
      </View>
      <View className="mx-4 mt-3 flex-row gap-2">
        {tiles.map(([value, label, hot]) => (
          <View
            key={label}
            className="flex-1 rounded-[20px] border border-border bg-card px-4 py-3"
          >
            <Text
              className={`text-[26px] font-bold ${hot ? "text-primary" : ""}`}
            >
              {value}
            </Text>
            <Text className="text-[12.5px] text-muted-foreground">{label}</Text>
          </View>
        ))}
      </View>
      <DayBars recap={recap} />
      <HourHeat recap={recap} />
      <TypeDonut recap={recap} />
      <SlackBars recap={recap} />
      <InsightChips lines={recap.insights} />
      <View className="mx-4 mt-3 flex-row gap-3">
        <Button
          testID="recap-replan"
          className="h-14 flex-1 rounded-[20px]"
          onPress={onReplan}
        >
          <Text className="text-[16px] font-semibold">{t("Replan week")}</Text>
        </Button>
        <Button
          testID="recap-free"
          variant="outline"
          className="h-14 flex-1 rounded-[20px] bg-card"
          onPress={onFree}
        >
          <Text className="text-[16px] font-semibold">
            {t("Find free time")}
          </Text>
        </Button>
      </View>
      <View style={{ height: 40 }} />
    </View>
  );
}

/** Up to six slots in two columns: day tile, time range, free length. One is picked and glows with a check. */
export function FreeView({
  slots,
  picked,
  onPick,
  onTry,
}: {
  slots: FreeSlotsResponse;
  picked: number;
  onPick: (i: number) => void;
  onTry?: () => void;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  if (!slots.length)
    return (
      <View testID="free-empty" className="items-center px-8 pt-24">
        <NoResultsMark />
        <Text className="mt-5 text-[17px] font-bold">{t("No free time")}</Text>
        {onTry && (
          <Button
            testID="free-try"
            variant="outline"
            className="mt-5 rounded-2xl bg-card px-5"
            onPress={onTry}
          >
            <Text>{t("Try a shorter time")}</Text>
          </Button>
        )}
      </View>
    );
  return (
    <View testID="free-view">
      <Text className="mx-5 mb-2 mt-3 text-[12px] font-semibold text-muted-foreground">
        {t("Times that suit you")}
      </Text>
      <View className="flex-row flex-wrap px-4" style={{ gap: 8 }}>
        {slots.slice(0, 6).map((s, i) => {
          const start = new Date(s.start);
          const on = i === picked;
          return (
            <Pressable
              key={s.start}
              testID={`slot-${i}`}
              onPress={() => onPick(i)}
              className="rounded-2xl border p-3"
              style={{
                width: "48.5%",
                borderColor: on ? c.orange : "rgba(128,128,128,0.2)",
                backgroundColor: on
                  ? `${c.orange}1A`
                  : isDarkColorScheme
                    ? "rgba(44,40,34,0.85)"
                    : "rgba(255,255,255,0.85)",
                shadowColor: c.orange,
                shadowOpacity: on ? 0.35 : 0,
                shadowRadius: 14,
                shadowOffset: { width: 0, height: 10 },
              }}
            >
              <View className="h-11 flex-row items-start justify-between">
                <View
                  className="size-11 items-center justify-center rounded-xl"
                  style={{ backgroundColor: c.dayTile }}
                >
                  <Text
                    className="text-[10px] font-semibold leading-3 text-white"
                    numberOfLines={1}
                  >
                    {format(start, "EEE").slice(0, 3)}
                  </Text>
                  <Text
                    className="mt-0.5 text-[16px] font-bold leading-[18px] text-white"
                    numberOfLines={1}
                  >
                    {format(start, "d")}
                  </Text>
                </View>
                {on && (
                  <LinearGradient
                    colors={[c.orange, c.yellow]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 12,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ico name="tick" size={14} color="#fff" stroke={3} />
                  </LinearGradient>
                )}
              </View>
              <Text
                className="mt-2 text-[15px] font-bold"
                numberOfLines={1}
              >{`${hm(start)} ${t("to")} ${hm(new Date(s.end))}`}</Text>
              <View
                className="mt-0.5 h-5 flex-row items-center"
                style={{ gap: 6 }}
              >
                <Text className="text-[12px] text-muted-foreground">{`${t("Free")} ${hours(s.freeMinutes)}`}</Text>
                {i === 0 && (
                  <View
                    className="rounded-full px-1.5 py-px"
                    style={{ backgroundColor: "rgba(180,230,80,0.5)" }}
                  >
                    <Text
                      className="text-[10.5px] font-semibold"
                      style={{ color: c.limeInk }}
                    >
                      {t("Best")}
                    </Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={{ height: 110 }} />
    </View>
  );
}

/** Replan: the before and after chart, one card per move, a warning for what has no room. */
export function ReplanView({
  preview,
  from,
  to,
}: {
  preview: ReplanPreview;
  from: Date;
  to: Date;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  if (!preview.moves.length && !preview.unplaced.length)
    return <EmptyView text={t("Nothing to change")} />;
  return (
    <View testID="replan-view">
      {preview.moves.length > 0 && (
        <ReplanDiff preview={preview} from={from} to={to} />
      )}
      {preview.moves.map((m, i) => {
        const a = new Date(m.from);
        const b = new Date(m.to);
        const days = differenceInCalendarDays(b, a);
        const weeks = weekOffset(b, from) - weekOffset(a, from);
        const when = (d: Date) =>
          format(d, weeks ? "EEE d/M HH:mm" : "EEE HH:mm");
        return (
          <View
            key={m.id}
            testID={`move-${m.id}`}
            className="mx-4 mt-2 flex-row overflow-hidden rounded-[20px] border border-border bg-card"
          >
            <View style={{ width: 4, backgroundColor: moveColor(i) }} />
            <View className="min-w-0 flex-1 px-4 py-3">
              <Text className="text-[16px] font-bold" numberOfLines={1}>
                {m.title}
              </Text>
              <View className="mt-1 flex-row items-center gap-2">
                <Text className="text-[13px] text-muted-foreground line-through">
                  {when(a)}
                </Text>
                <Ico name="arrow" size={14} color={c.orange} />
                <Text className="text-[13px] font-bold">
                  {when(b)}
                </Text>
              </View>
            </View>
            {weeks !== 0 ? (
              <View
                className="mr-3 self-center rounded-full px-3 py-1"
                style={{ backgroundColor: "#E5484D" }}
              >
                <Text className="text-[12px] font-bold text-white">
                  {weeks < 0 ? t("Previous week") : t("Next week")}
                </Text>
              </View>
            ) : days !== 0 ? (
              <View className="mr-3 self-center rounded-full bg-emerald-500/15 px-3 py-1">
                <Text
                  className="text-[12.5px] font-semibold"
                  style={{ color: c.good }}
                >{`${days > 0 ? "+" : ""}${days} ${t("d")}`}</Text>
              </View>
            ) : null}
          </View>
        );
      })}
      {preview.unplaced.length > 0 && (
        <View className="mx-4 mt-3 flex-row items-center gap-2 rounded-2xl bg-primary/10 px-3 py-2.5">
          <Ico name="warn" size={16} color={c.orange} />
          <Text className="min-w-0 flex-1 text-[13.5px]">{`${t("No room for")}: ${preview.unplaced.map((u) => u.title).join(", ")}`}</Text>
        </View>
      )}
      <View style={{ height: 110 }} />
    </View>
  );
}

export interface Proposed {
  type: SessionType;
  title: string;
  sub: string;
  start: Date;
  end: Date;
}

const ROW = 22;
const toneOf = (type: SessionType) =>
  SESSION_TONES[SESSION_TYPE_TONE[type]].base;

/** Skeleton in the shape of the result while the scheduler works. */
export function PreviewSkeleton() {
  const reduce = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (!reduce)
      o.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
  }, [o, reduce]);
  const pulse = useAnimatedStyle(() => ({ opacity: o.value }));
  return (
    <Animated.View testID="preview-skeleton" style={pulse}>
      <Card>
        <View className="mb-3 h-4 w-28 rounded-lg bg-muted/60" />
        {[64, 80, 52].map((h) => (
          <View
            key={h}
            className="mb-2.5 rounded-2xl bg-muted/60"
            style={{ height: h }}
          />
        ))}
      </Card>
    </Animated.View>
  );
}

/** Banner when the phone is offline: a dusk card that says viewing works and editing does not. Not an error. */
export function OfflineBanner() {
  const offline = useConnectivity(selectOffline);
  if (!offline) return null;
  return (
    <View
      testID="offline-banner"
      className="mx-4 mt-3 overflow-hidden rounded-2xl"
      style={{
        borderWidth: 1,
        borderColor: "rgba(252,211,77,0.3)",
        shadowColor: "#F0B100",
        shadowOpacity: 0.3,
        shadowRadius: 15,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <LinearGradient
        colors={["#3A3366", "#1F2A4D"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 12 }}
      >
        <View
          pointerEvents="none"
          className="absolute rounded-full"
          style={{
            left: -24,
            top: -32,
            width: 96,
            height: 96,
            backgroundColor: "rgba(252,211,77,0.22)",
          }}
        />
        <View className="flex-row items-center gap-3">
          <LinearGradient
            colors={["#F7DE6B", "#F0A53A"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 4,
              borderColor: "rgba(250,204,21,0.25)",
            }}
          >
            <Ico name="cloudOff" size={20} color="#451A03" />
          </LinearGradient>
          <View className="min-w-0 flex-1">
            <Text className="text-[14.5px] font-bold" style={{ color: "#fff" }}>
              {t("You are offline")}
            </Text>
            <Text
              className="text-[12px]"
              style={{ color: "rgba(255,255,255,0.7)" }}
            >
              {t("Showing your saved calendar")}
            </Text>
          </View>
          <View style={{ gap: 4 }}>
            <View
              className="flex-row items-center gap-1 self-start rounded-full px-2 py-0.5"
              style={{ backgroundColor: "rgba(52,211,153,0.2)" }}
            >
              <Ico name="eye" size={12} color="#6EE7B7" />
              <Text
                className="text-[11px] font-bold"
                style={{ color: "#6EE7B7" }}
              >
                {t("View")}
              </Text>
            </View>
            <View
              className="flex-row items-center gap-1 self-start rounded-full px-2 py-0.5"
              style={{ backgroundColor: "rgba(252,211,77,0.2)" }}
            >
              <Ico name="plus" size={12} color="#FDE68A" />
              <Text
                className="text-[11px] font-bold"
                style={{ color: "#FDE68A", textDecorationLine: "line-through" }}
              >
                {t("Edit")}
              </Text>
            </View>
          </View>
        </View>
      </LinearGradient>
    </View>
  );
}

/** The day strip and an hour grid: real sessions solid, proposed ones dashed in their type colour, or solid once added. */
export function DayPreview({
  proposed,
  first: from,
  settled = false,
}: {
  proposed: Proposed[];
  first?: Date;
  settled?: boolean;
}) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  // Only the days that receive a task, soonest first; a plain view shows a week from `from`.
  const base = startOfDay(from ?? proposed[0]?.start ?? new Date());
  const days = proposed.length
    ? [
        ...new Map(
          proposed.map((p) => [
            startOfDay(p.start).getTime(),
            startOfDay(p.start),
          ]),
        ).entries(),
      ]
        .sort(([x], [y]) => x - y)
        .map(([, d]) => d)
    : Array.from({ length: 7 }, (_, i) => addDays(base, i));
  const [day, setDay] = useState(days[0]);
  const [real, setReal] = useState<Session[]>([]);
  useEffect(() => {
    let live = true;
    listSessions(day, day).then(
      (r) =>
        live &&
        setReal(
          r.sessions.filter(
            (s) =>
              s.scheduledStartTime &&
              isSameDay(new Date(s.scheduledStartTime), day),
          ),
        ),
      () => live && setReal([]),
    );
    return () => {
      live = false;
    };
  }, [day.getTime()]);

  const mine = proposed.filter((p) => isSameDay(p.start, day));
  const end = (s: Session) =>
    new Date(
      new Date(s.scheduledStartTime!).getTime() + s.durationMinutes * 60_000,
    );
  const blocks = [
    ...real.map((s) => ({
      title: s.title,
      sub: "",
      place: s.location,
      type: s.type as SessionType,
      start: new Date(s.scheduledStartTime!),
      end: end(s),
      isNew: false,
    })),
    ...mine.map((p) => ({
      title: p.title,
      sub: p.sub,
      place: null as string | null,
      type: p.type,
      start: p.start,
      end: p.end,
      isNew: !settled,
    })),
  ];
  const at = (d: Date) => d.getHours() + d.getMinutes() / 60;
  const top = Math.min(7, ...blocks.map((b) => Math.floor(at(b.start))));
  const bottom = Math.max(22, ...blocks.map((b) => Math.ceil(at(b.end))));
  const now = new Date();
  const nowAt =
    isSameDay(now, day) && at(now) >= top && at(now) <= bottom ? at(now) : null;
  const count = (d: Date) =>
    proposed.filter((p) => isSameDay(p.start, d)).length;

  return (
    <View testID="day-preview">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="mt-4"
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}
      >
        {days.map((d, i) => {
          const on = isSameDay(d, day);
          const n = count(d);
          return (
            <Pressable
              key={d.toISOString()}
              testID={`day-${format(d, "d")}`}
              onPress={() => setDay(d)}
              className={`h-[70px] w-[46px] items-center justify-center rounded-[18px] ${on ? "" : "bg-card"}`}
              style={on ? { backgroundColor: c.orange } : undefined}
            >
              <Text
                className={`text-[11px] font-semibold ${on ? "text-white" : "text-muted-foreground"}`}
              >
                {format(d, "EEE")}
              </Text>
              <Text
                className={`font-extrabold ${on ? "text-white" : ""} ${days.some((x) => x.getMonth() !== d.getMonth()) ? "text-[14px]" : "text-[18px]"}`}
              >
                {format(
                  d,
                  days.some((x) => x.getMonth() !== d.getMonth()) ? "d/M" : "d",
                )}
              </Text>
              <View className="mt-0.5 h-1.5 flex-row gap-0.5">
                {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                  <View
                    key={i}
                    className="size-1 rounded-full"
                    style={{
                      backgroundColor: on
                        ? "#fff"
                        : [KIND_COLOR.length, c.orange, KIND_COLOR.day][i],
                    }}
                  />
                ))}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
      <Card className="p-4">
        <Text className="text-[18px] font-bold">{format(day, "EEEE d/M")}</Text>
        <Text className="mb-2 text-[13px] text-muted-foreground">
          {proposed.length
            ? t("{n} new, {m} already planned", {
                n: mine.length,
                m: blocks.length - mine.length,
              })
            : t("{n} sessions", { n: blocks.length })}
        </Text>
        <View style={{ height: (bottom - top) * ROW + 12 }}>
          {Array.from({ length: bottom - top + 1 }, (_, i) => (
            <View
              key={i}
              className="absolute inset-x-0 flex-row items-center"
              style={{ top: i * ROW }}
            >
              <Text className="w-10 text-[11px] text-muted-foreground">{`${String(top + i).padStart(2, "0")}:00`}</Text>
              <View className="h-px flex-1 bg-border" />
            </View>
          ))}
          {blocks.map((b, i) => {
            const color = toneOf(b.type);
            const h = Math.max(20, (at(b.end) - at(b.start)) * ROW - 2);
            const roomy = h >= 46;
            return (
              <View
                key={i}
                testID={b.isNew ? `new-block-${i}` : undefined}
                className="absolute right-0 overflow-hidden"
                style={{
                  left: 46,
                  top: (at(b.start) - top) * ROW + 8,
                  height: h,
                  borderRadius: 9,
                  paddingHorizontal: 10,
                  paddingVertical: roomy ? 6 : 2,
                  justifyContent: roomy ? "flex-start" : "center",
                  backgroundColor: tint(
                    color,
                    b.isNew ? 0.2 : b.type === "DND" ? 0.1 : 0.18,
                  ),
                  ...(b.isNew
                    ? {
                        borderWidth: 1.5,
                        borderStyle: "dashed",
                        borderColor: color,
                      }
                    : { borderLeftWidth: 3, borderLeftColor: color }),
                }}
              >
                <Text className="text-[13.5px] font-bold" numberOfLines={1}>
                  {b.title}
                </Text>
                {roomy && b.place ? (
                  <View className="mt-1 flex-row items-center gap-1 self-start rounded-full bg-card/80 px-2 py-0.5">
                    <Ico name="pin" size={12} color={c.orange} />
                    <Text className="text-[11.5px]">{b.place}</Text>
                  </View>
                ) : null}
                {roomy && b.sub ? (
                  <Text className="text-[12px] text-muted-foreground">
                    {b.sub}
                  </Text>
                ) : null}
                {b.isNew && (
                  <View
                    className="absolute right-0 top-0 rounded-bl-lg px-2 py-0.5"
                    style={{ backgroundColor: color }}
                  >
                    <Text className="text-[10px] font-bold text-white">
                      {t("New")}
                    </Text>
                  </View>
                )}
              </View>
            );
          })}
          {nowAt !== null && (
            <View
              pointerEvents="none"
              className="absolute flex-row items-center"
              style={{ left: 40, right: -16, top: (nowAt - top) * ROW + 8 }}
            >
              <View
                className="size-2.5 rounded-full"
                style={{ backgroundColor: c.orange }}
              />
              <View
                className="h-px flex-1"
                style={{ backgroundColor: c.orange }}
              />
            </View>
          )}
        </View>
      </Card>
    </View>
  );
}

const CHIP = {
  length: { icon: "clock", color: KIND_COLOR.length },
  day: { icon: "flag", color: KIND_COLOR.day },
  part: { icon: "moon", color: KIND_COLOR.part },
  clock: { icon: "clock", color: KIND_COLOR.clock },
  place: { icon: "pin", color: KIND_COLOR.place },
  from: { icon: "calendar", color: KIND_COLOR.repeat },
  repeat: { icon: "replan", color: KIND_COLOR.repeat },
  split: { icon: "sliders", color: KIND_COLOR.length },
  warn: { icon: "warn", color: "#FF8E3E" },
  bad: { icon: "warn", color: "#E7000B" },
} as const;

function Chip({ kind, label }: { kind: keyof typeof CHIP; label: string }) {
  const k = CHIP[kind];
  return (
    <View
      className="flex-row items-center gap-1 rounded-full px-2.5 py-0.5"
      style={{ backgroundColor: tint(k.color, 0.2) }}
    >
      <Ico name={k.icon} size={12} color={k.color} />
      <Text className="text-[12.5px] font-medium">{label}</Text>
    </View>
  );
}

export interface LineCard {
  index: number;
  title: string;
  slot: string | null;
  chips: { kind: keyof typeof CHIP; label: string }[];
  error: string | null;
}

/** One card per added item: number, title, where it lands, chips for what was read. A red card needs a fix. */
export function LineCards({
  cards,
  onFix,
}: {
  cards: LineCard[];
  onFix: () => void;
}) {
  const bad = cards.filter((c) => c.error).length;
  return (
    <View testID="line-cards">
      <View className="mx-6 mt-3 flex-row justify-between">
        <Text className="text-[13px] text-muted-foreground">
          {t("{n} items", { n: cards.length })}
        </Text>
        {bad > 0 && (
          <Text className="text-[13px] text-muted-foreground">
            {t("{n} to fix", { n: bad })}
          </Text>
        )}
      </View>
      {cards.map((c) => (
        <Pressable
          key={c.index}
          disabled={!c.error}
          onPress={onFix}
          className={`mx-4 mt-2 rounded-[20px] border px-4 py-3 ${c.error ? "border-destructive/50 bg-destructive/5" : "border-border bg-card"}`}
        >
          <View className="flex-row items-center gap-2.5">
            <View
              className={`size-6 items-center justify-center rounded-full ${c.error ? "bg-destructive" : "bg-muted"}`}
            >
              <Text
                className={`text-[12px] font-bold ${c.error ? "text-white" : ""}`}
              >
                {c.index + 1}
              </Text>
            </View>
            <Text
              className="min-w-0 flex-1 text-[16px] font-semibold"
              numberOfLines={1}
            >
              {c.title}
            </Text>
            <Text
              className={`text-[13.5px] font-bold ${c.error ? "text-destructive" : "text-primary"}`}
            >
              {c.error ? t("Fix") : (c.slot ?? "")}
            </Text>
          </View>
          <View
            className="mt-2 flex-row flex-wrap"
            style={{ gap: 6, paddingLeft: 34 }}
          >
            {c.chips.map((k) => (
              <Chip key={k.label} {...k} />
            ))}
            {c.error ? <Chip kind="bad" label={c.error} /> : null}
          </View>
        </Pressable>
      ))}
    </View>
  );
}

/** Two replan modes, each with a small picture of what it does. */
export function ModeMenu({ onPick }: { onPick: (m: ReplanChange) => void }) {
  const { isDarkColorScheme } = useColorScheme();
  const c = paletteColors(isDarkColorScheme);
  const Box = ({ ghost, lime }: { ghost?: boolean; lime?: boolean }) => (
    <View
      className="mr-1 h-3.5 w-3.5 rounded-[4px]"
      style={{
        backgroundColor: lime ? "#D8F99966" : c.orange,
        ...(ghost || lime
          ? {
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: lime ? "#9BC53D" : c.orange,
            }
          : {}),
      }}
    />
  );
  const rows: [ReplanChange, "scale" | "sun", string, string][] = [
    [
      "balanced",
      "scale",
      "Balanced",
      "Stays near the old time, moves only when needed",
    ],
    ["free", "sun", "Free up", "Groups tasks, leaves long open stretches"],
  ];
  return (
    <ResultPanel testID="mode-menu" title={t("How to replan")}>
      {rows.map(([id, icon, title, sub], i) => (
        <Pressable
          key={id}
          testID={`mode-${id}`}
          onPress={() => onPick(id)}
          className={`flex-row items-center gap-3 rounded-2xl px-3 py-2 ${i === 0 ? "bg-primary/10" : ""}`}
        >
          <View
            className={`size-9 items-center justify-center rounded-[10px] ${i === 0 ? "bg-primary" : "bg-muted"}`}
          >
            <Ico name={icon} size={20} color={i === 0 ? c.ink : "#6F665B"} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] font-semibold">{t(title)}</Text>
            <Text
              className="text-[12.5px] text-muted-foreground"
              numberOfLines={1}
            >
              {t(sub)}
            </Text>
          </View>
          <View className="flex-row">
            {id === "balanced"
              ? [0, 1, 2].map((k) => <Box key={k} ghost />)
              : [<Box key={0} />, <Box key={1} />, <Box key={2} lime />]}
          </View>
        </Pressable>
      ))}
    </ResultPanel>
  );
}
