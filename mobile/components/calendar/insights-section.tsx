import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { getInsights } from "@/api/insights";
import { SunriseIcon } from "@/components/brand/icons";
import { EmptyMark } from "@/components/brand/state-marks";
import { ChevronRight } from "@/components/Icons";
import { LoadError } from "@/components/load-error";
import { BottomSheet, BottomSheetContent, BottomSheetHeader, BottomSheetScrollView } from "@/components/ui/bottom-sheet";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { useLanguage } from "@/hooks/use-language";
import { useOffline } from "@/hooks/use-offline";
import { useUserStore } from "@/hooks/use-user-store";
import { GlassButton } from "@/components/ui/glass-button";
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
import { ScrollView, View } from "react-native";

/** Brand orange, as in `packages/core/src/palette.ts`. */
const SUN = "#FF8E3E";

/** Heat per bucket, 0 (none) to 4 (busiest). Bright brand lime in dark mode. */
const HEAT = [
  "bg-muted",
  "bg-brand-lime/30",
  "bg-brand-lime/55",
  "bg-brand-lime/80",
  "bg-brand-lime",
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
    <View className={cn("w-[48%] gap-2 rounded-2xl p-3.5", done ? "bg-brand-lime/10 border border-brand-lime/30" : "bg-secondary border border-border")}>
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
    <View
      className={cn(
        "w-48 gap-2 rounded-2xl p-3.5",
        ready
          ? "bg-brand-lime/10 border border-brand-lime/30"
          : "bg-muted border border-border/60",
      )}
    >
      <View className="flex-row items-center gap-2">
        <View className={cn("h-2 w-2 rounded-full", ready ? "bg-brand-lime" : "bg-muted-foreground/50")} />
        <Text numberOfLines={1} className="flex-1 text-[14px] font-semibold">
          {item.title}
        </Text>
      </View>
      <Text
        numberOfLines={1}
        className={cn("text-[12px]", ready ? "text-brand-lime font-semibold" : "text-muted-foreground")}
      >
        {t(label.key, label.values)}
      </Text>
    </View>
  );
}

type SheetHandle = { present: () => void; dismiss: () => void };

type InsightsContextShape = {
  open: boolean;
  setOpen: (open: boolean) => void;
  present: () => void;
  dismiss: () => void;
  sheetRef: RefObject<SheetHandle | null>;
};
const InsightsContext = createContext<InsightsContextShape | null>(null);

/** Shared open state so the compact trigger (next to the `+` in the week
 * header) and the sheet (mounted unclipped at screen root) stay in sync.
 * `present`/`dismiss` drive the sheet imperatively. */
export function InsightsProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<SheetHandle | null>(null);
  const present = useCallback(() => sheetRef.current?.present(), []);
  const dismiss = useCallback(() => sheetRef.current?.dismiss(), []);
  return (
    <InsightsContext.Provider value={{ open, setOpen, present, dismiss, sheetRef }}>
      {children}
    </InsightsContext.Provider>
  );
}

function useInsights() {
  const ctx = useContext(InsightsContext);
  if (!ctx) throw new Error("useInsights must be used within an InsightsProvider");
  return ctx;
}

/** The compact trigger button: lives next to the `+` in the week header. */
export function InsightsTrigger() {
  const { setOpen, present } = useInsights();
  useLanguage();
  return (
    <GlassButton
      icon={SunriseIcon}
      accessibilityLabel={t("Insights")}
      onPress={() => {
        setOpen(true);
        present();
      }}
      testID="calendar.insights"
    />
  );
}

/** The insights sheet: mounted unclipped at screen root, presented by the
 * trigger via shared state. */
export function InsightsSheet() {
  useLanguage();
  const { open, setOpen, dismiss, sheetRef } = useInsights();
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const offline = useOffline();
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
      {/* Presented imperatively via `present`/`dismiss` from the provider. The
         handle is captured on BottomSheetContent's ref. */}
      <BottomSheetContent
        ref={sheetRef as any}
        snapPoints={["85%"]}
        enableDynamicSizing={false}
        onDismiss={dismiss}
      >
        <BottomSheetHeader className="border-b-0 px-5 pb-3">
          <View className="flex-row items-center gap-3">
            <View className="size-10 items-center justify-center rounded-xl bg-brand-orange/10">
              <SunriseIcon color={SUN} size={20} />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-[15px] font-semibold">{t("Insights")}</Text>
              <Text className="text-[13px] text-muted-foreground">{t("Last 7 days")}</Text>
            </View>
            <ChevronRight size={18} className="text-muted-foreground" />
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

/** Combined convenience: provider + trigger + sheet (kept for tests). */
export function InsightsSection() {
  return (
    <InsightsProvider>
      <InsightsTrigger />
      <InsightsSheet />
    </InsightsProvider>
  );
}
