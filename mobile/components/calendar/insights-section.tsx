import { getInsights } from "@/api/insights";
import { SunriseIcon } from "@/components/brand/icons";
import { EmptyMark } from "@/components/brand/state-marks";
import { ChevronRight } from "@/components/Icons";
import { LoadError } from "@/components/load-error";
import {
  BottomSheet,
  BottomSheetContent,
  BottomSheetHeader,
  BottomSheetOpenTrigger,
  BottomSheetScrollView,
} from "@/components/ui/bottom-sheet";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useOffline } from "@/hooks/use-offline";
import { useUserStore } from "@/hooks/use-user-store";
import { locale, t } from "@/lib/i18n";
import {
  bufferLabel,
  focusGrid,
  focusReady,
  focusTotal,
  gridMax,
  heatLevel,
  hoursOf,
  insightsWindow,
} from "@/lib/insights";
import { subscribeToSessionMutations } from "@/lib/session-cache";
import { cn } from "@/lib/utils";
import { zonedNow } from "@zenflow/core";
import type { BufferItem, InsightsResponse, WeeklyRecap } from "@zenflow/shared";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";

/** Brand orange, as in `packages/core/src/palette.ts`. */
const SUN = "#FF8E3E";

/** Heat per bucket, 0 (none) to 4 (busiest). */
const HEAT = [
  "bg-muted",
  "bg-brand-lime/20",
  "bg-brand-lime/40",
  "bg-brand-lime/65",
  "bg-brand-lime/90",
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const HOUR_MARKS = [0, 6, 12, 18];

function FocusMap({ data }: { data: InsightsResponse }) {
  const grid = focusGrid(data.focus);
  const max = gridMax(grid);
  const hours = Array.from({ length: 24 }, (_, h) => h);
  return (
    <View
      testID="insights.focus-map"
      accessible
      accessibilityLabel={t("Focus map, {count} done", { count: focusTotal(data.focus) })}
      className="gap-2"
    >
      <View className="flex-row gap-1 pl-7">
        {WEEKDAYS.map((day) => (
          <Text key={day} className="flex-1 text-center text-[11px] font-medium text-muted-foreground">
            {t(day)}
          </Text>
        ))}
      </View>
      <View className="gap-1">
        {hours.map((hour) => (
          <View key={hour} className="h-3 flex-row items-center gap-1">
            <View className="w-6 items-end">
              {HOUR_MARKS.includes(hour) ? (
                <Text className="text-[10px] leading-[12px] text-muted-foreground">{String(hour)}</Text>
              ) : null}
            </View>
            {WEEKDAYS.map((_, weekday) => (
              <View
                key={weekday}
                className={cn("h-full flex-1 rounded-[4px]", HEAT[heatLevel(grid[weekday][hour], max)])}
              />
            ))}
          </View>
        ))}
      </View>
      <View className="flex-row items-center justify-end gap-1.5 pt-1">
        <Text className="text-[11px] text-muted-foreground">{t("Less")}</Text>
        {HEAT.map((tone) => (
          <View key={tone} className={cn("h-2.5 w-2.5 rounded-[3px]", tone)} />
        ))}
        <Text className="text-[11px] text-muted-foreground">{t("More")}</Text>
      </View>
    </View>
  );
}

function StatTile({
  label,
  value,
  done = false,
  progress,
}: {
  label: string;
  value: string;
  done?: boolean;
  progress?: number;
}) {
  return (
    <View className={cn("w-[48%] gap-2 rounded-2xl p-3.5", done ? "bg-brand-lime/10" : "bg-secondary")}>
      <Text className="text-[12px] font-medium text-muted-foreground">{label}</Text>
      <Text className="text-[26px] font-bold leading-[30px] tracking-tight">{value}</Text>
      {progress !== undefined ? (
        <Progress value={progress} className="h-1.5" indicatorClassName="bg-brand-lime" />
      ) : null}
    </View>
  );
}

function hoursText(minutes: number): string {
  const hours = hoursOf(minutes).toLocaleString(locale(), { maximumFractionDigits: 1 });
  return t("{hours} h", { hours });
}

function RecapCard({ recap }: { recap: WeeklyRecap }) {
  const share =
    recap.plannedMinutes > 0
      ? Math.min(100, Math.round((recap.doneMinutes / recap.plannedMinutes) * 100))
      : undefined;
  return (
    <View testID="insights.recap" className="flex-row flex-wrap justify-between gap-2.5">
      <StatTile label={t("Planned")} value={hoursText(recap.plannedMinutes)} />
      <StatTile label={t("Done")} value={hoursText(recap.doneMinutes)} done progress={share} />
      <StatTile label={t("On time")} value={String(recap.onTimeCount)} />
      <StatTile label={t("Not this time")} value={String(recap.notThisTimeCount)} />
    </View>
  );
}

function BufferChip({ item }: { item: BufferItem }) {
  const label = bufferLabel(item.bufferDays);
  const ready = item.bufferDays !== null;
  return (
    <View className="w-48 gap-2 rounded-2xl border border-border bg-card p-3.5">
      <View className="flex-row items-center gap-2">
        <View className={cn("h-2 w-2 rounded-full", ready ? "bg-brand-lime" : "bg-muted-foreground/40")} />
        <Text numberOfLines={1} className="flex-1 text-[14px] font-semibold">
          {item.title}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        className={cn("text-[12px]", ready ? "text-brand-lime" : "text-muted-foreground")}
      >
        {t(label.key, label.values)}
      </Text>
    </View>
  );
}

/**
 * Insights in a sheet opened from the day view: the focus map, a seven-day
 * recap and prep buffers for upcoming exams and assignments. Loads when
 * opened and again after any session change while it is open.
 */
export function InsightsSection() {
  useLanguage();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const offline = useOffline();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<{ data: InsightsResponse | null; error: boolean }>({
    data: null,
    error: false,
  });
  const latest = useRef(0);

  const load = useCallback(() => {
    const request = ++latest.current;
    const { from, to } = insightsWindow(zonedNow(tz));
    getInsights(from, to).then(
      (data) => {
        if (request === latest.current) setView({ data, error: false });
      },
      () => {
        if (request === latest.current) setView((cur) => ({ data: cur.data, error: true }));
      },
    );
  }, [tz]);

  useEffect(() => {
    if (!open) return;
    load();
    return subscribeToSessionMutations(load);
  }, [open, load]);

  const { data, error } = view;

  return (
    <BottomSheet>
      <BottomSheetOpenTrigger
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t("Insights")}
        testID="calendar.insights"
        className="w-full flex-row items-center gap-3.5 rounded-2xl border border-border bg-card px-4 py-3.5 active:opacity-70"
      >
        <View className="size-10 items-center justify-center rounded-xl bg-brand-orange/10">
          <SunriseIcon color={SUN} size={20} />
        </View>
        <View className="flex-1 gap-0.5">
          <Text className="text-[15px] font-semibold">{t("Insights")}</Text>
          <Text className="text-[13px] text-muted-foreground">{t("Focus map, recap and prep")}</Text>
        </View>
        <ChevronRight size={18} className="text-muted-foreground" />
      </BottomSheetOpenTrigger>
      <BottomSheetContent
        snapPoints={["85%"]}
        enableDynamicSizing={false}
        onDismiss={() => setOpen(false)}
      >
        <BottomSheetHeader className="border-b-0 px-5 pb-3">
          <View className="flex-row items-center gap-3">
            <EmptyMark size={44} />
            <View className="gap-0.5">
              <Text className="text-[22px] font-bold tracking-tight">{t("Insights")}</Text>
              <Text className="text-[13px] text-muted-foreground">{t("Last 7 days")}</Text>
            </View>
          </View>
        </BottomSheetHeader>
        <BottomSheetScrollView>
          <View className="gap-5 px-5 pb-10">
            {data ? (
              <>
                <RecapCard recap={data.recap} />
                <View className="gap-3 rounded-2xl border border-border bg-card p-4">
                  <Text className="text-[13px] font-semibold text-muted-foreground">{t("Focus")}</Text>
                  {focusReady(data.focus) ? (
                    <FocusMap data={data} />
                  ) : (
                    <View className="items-center gap-2 py-2">
                      <EmptyMark size={48} />
                      <Text className="text-center text-[14px] text-muted-foreground">
                        {t("Your focus map fills in as you finish sessions")}
                      </Text>
                    </View>
                  )}
                </View>
                {data.buffers.length > 0 ? (
                  <View className="gap-2.5">
                    <Text className="px-1 text-[13px] font-semibold text-muted-foreground">
                      {t("Ahead of deadlines")}
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={{ gap: 10, paddingRight: 20 }}
                    >
                      {data.buffers.map((item) => (
                        <BufferChip key={item.sessionId} item={item} />
                      ))}
                    </ScrollView>
                  </View>
                ) : null}
              </>
            ) : error ? (
              <LoadError
                offline={offline}
                message={t("Couldn't load insights.")}
                offlineMessage={t("Back online to see insights.")}
                onRetry={load}
              />
            ) : (
              <>
                <Skeleton className="h-44 rounded-2xl" />
                <Skeleton className="h-52 rounded-2xl" />
              </>
            )}
          </View>
        </BottomSheetScrollView>
      </BottomSheetContent>
    </BottomSheet>
  );
}
