import { useCallback, useEffect, useState } from "react";
import type { RefObject } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { BookOpen, CalendarClock, FileText, GraduationCap, Sparkles, X } from "lucide-react-native";
import {
  buildToday,
  deriveState,
  SESSION_TONE_CLASSES,
  sessionTone,
  type TodayItem,
  type TodayView,
  zonedDate,
} from "@zenflow/core";
import type { Session, SessionType } from "@zenflow/shared";
import type { SessionDetailSheetHandle } from "@/components/calendar/session-detail-sheet";
import { listSessions } from "@/api/tasks";
import { EmptyMark } from "@/components/brand/state-marks";
import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { useNow } from "@/hooks/use-now";
import { useUserStore } from "@/hooks/use-user-store";
import { t } from "@/lib/i18n";
import { filterHidden } from "@/lib/hidden-sessions";
import { format } from "date-fns";

const TYPE_ICON: Record<SessionType, typeof BookOpen> = {
  LECTURE: BookOpen,
  ASSIGNMENT: FileText,
  EXAM: GraduationCap,
  TASK: Sparkles,
  DND: CalendarClock,
};

const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: "Lecture",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  TASK: "Study",
  DND: "Busy",
};

const ABSOLUTE_FILL = StyleSheet.absoluteFill;

function useTodayView(tz: string) {
  const now = useNow();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const load = useCallback(async () => {
    try {
      const data = await listSessions("day", new Date());
      setSessions(filterHidden(data.sessions));
    } catch {
      // Keep the last load on screen; the day timeline shows its own error.
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  if (!sessions) return { view: null as TodayView | null, loading: true, sessions: null };
  return { view: buildToday(sessions, now, tz), loading: false, sessions };
}

function Later({ items, tz }: { items: TodayItem[]; tz: string }) {
  if (items.length === 0) return null;
  return (
    <View className="flex-row gap-2">
      {items.slice(0, 3).map((item) => {
        const Icon = TYPE_ICON[item.type];
        return (
          <View key={item.id} className="w-24 gap-1 rounded-2xl border border-border/60 bg-card/60 px-3 py-2">
            <Text className="text-[10px] opacity-70">{format(zonedDate(item.start, tz), "HH:mm")}</Text>
            <Icon size={15} color="#FF8E3E" />
            <Text className="text-[11px] font-semibold truncate" numberOfLines={1}>
              {item.title}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * A compact floating glass pill showing what's coming up next. It floats over
 * the calendar grid (never takes a layout block) and is intentionally small —
 * one row, brand-coloured icon, title and time. Tapping it opens the full
 * today card as an overlay on top of the grid.
 */
export function TodayPill({ onPress }: { onPress: () => void }) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const { view, loading } = useTodayView(tz);
  if (loading || !view) return null;
  const next = view.next;
  if (!next) return null;

  const Icon = TYPE_ICON[next.type];
  const tone = SESSION_TONE_CLASSES[sessionTone(deriveState({ type: next.type }))];
  const started = next.start.getTime() <= now.getTime();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t(started ? "On now" : "Up next")}
      onPress={onPress}
      className="flex-row items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5"
    >
      <View className="size-6 rounded-xl items-center justify-center {tone.dot}">
        <Icon size={15} color="#FFFFFF" />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-[11px] font-medium text-muted-foreground">
          {t(started ? "On now" : "Up next")}
        </Text>
        <Text className="text-sm font-semibold truncate" numberOfLines={1}>{next.title}</Text>
      </View>
      <View className="w-px bg-border/40 h-3 self-stretch" />
      <Text className="text-xs font-medium text-muted-foreground">
        {format(zonedDate(next.start, tz), "HH:mm")} – {format(zonedDate(next.end, tz), "HH:mm")}
      </Text>
    </Pressable>
  );
}

/**
 * The full today card, floating on top of the calendar grid (a sheet-like
 * overlay, never a layout block). Shown when the user taps the pill.
 * Brand-coloured icon, a large title and the coming-up rows — no "Start"
 * button, nothing plain.
 */
export interface TodayCardOverlayProps {
  visible: boolean;
  onClose: () => void;
  /** Opens the next session's detail sheet when the card body is tapped. */
  sessionDetailSheetRef: RefObject<SessionDetailSheetHandle | null>;
}

export function TodayCardOverlay({ visible, onClose, sessionDetailSheetRef }: TodayCardOverlayProps) {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const { view, loading, sessions } = useTodayView(tz);

  const backdrop = (
    <Pressable onPress={onClose} accessibilityLabel={t("Close")} style={ABSOLUTE_FILL} className="bg-black/35" />
  );

  if (!visible) return null;
  if (loading) {
    return (
      <View style={ABSOLUTE_FILL} className="flex-1 items-center justify-center bg-black/40 z-[60]">
        <EmptyMark size={34} />
      </View>
    );
  }
  const next = view?.next;
  if (!next) {
    return (
      <View style={ABSOLUTE_FILL} className="flex-1 items-center justify-center bg-black/40 z-[60]">
        <Glass radius={20} style={{ paddingHorizontal: 20, paddingVertical: 16 }}>
          <View className="flex-row items-center justify-between gap-3">
            <View className="min-w-0 flex-1">
              <Text className="text-xs opacity-70">{t("Today")}</Text>
              <Text className="text-base font-semibold">{t("Nothing left today")}</Text>
            </View>
            <EmptyMark size={40} />
          </View>
        </Glass>
      </View>
    );
  }

  const Icon = TYPE_ICON[next.type];
  const tone = SESSION_TONE_CLASSES[sessionTone(deriveState({ type: next.type }))];
  const started = next.start.getTime() <= now.getTime();

  function openDetail() {
    const session = sessions?.find((s) => s.id === next?.id);
    if (session) sessionDetailSheetRef.current?.open(session);
  }

  return (
    <View style={ABSOLUTE_FILL} className="flex-1 z-[60]">
      {backdrop}
      <View style={{ position: "absolute", top: 110, left: 0, right: 0, zIndex: 61 }} className="items-center">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Open session")}
          onPress={openDetail}
          className="w-[92%]"
        >
          <Glass radius={22} style={{ padding: 18, gap: 14, width: "100%" }}>
            <View className="flex-row items-start justify-between gap-3">
              <Pressable onPress={onClose} accessibilityLabel={t("Close")} hitSlop={12} style={{ padding: 4 }}>
                <X size={18} color="#FBFAF8" />
              </Pressable>
              <View className="flex-row items-center gap-1.5 rounded-full px-2.5 py-1 {tone.badge}">
                <Icon size={14} color="#FFFFFF" />
                <Text className="text-xs font-medium">{t(started ? "On now" : "Up next")}</Text>
              </View>
              <Text className="text-xs font-medium text-muted-foreground">
                {format(zonedDate(next.start, tz), "HH:mm")} – {format(zonedDate(next.end, tz), "HH:mm")}
              </Text>
            </View>
            <View className="gap-1">
              <Text className="text-2xl font-semibold tracking-tight" numberOfLines={1}>
                {next.title}
              </Text>
              <Text className="text-sm opacity-70">{t(TYPE_LABEL[next.type])}</Text>
              <Text className="text-sm opacity-80">
                {t("{start} to {end}", {
                  start: format(zonedDate(next.start, tz), "HH:mm"),
                  end: format(zonedDate(next.end, tz), "HH:mm"),
                })}
              </Text>
            </View>
            <View className="flex-row items-end justify-between gap-3">
              <Later items={view.later} tz={tz} />
              <Text className="text-xs font-medium opacity-60">{t("Tap to open")}</Text>
            </View>
          </Glass>
        </Pressable>
      </View>
    </View>
  );
}
