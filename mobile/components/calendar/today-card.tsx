import { useCallback, useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { BookOpen, CalendarClock, FileText, GraduationCap, Play, Sparkles } from "lucide-react-native";
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
import { listSessions, recordSessionStart } from "@/api/tasks";
import { EmptyMark } from "@/components/brand/state-marks";
import { Glass } from "@/components/ui/glass";
import { Text } from "@/components/ui/text";
import { useNow } from "@/hooks/use-now";
import { useUserStore } from "@/hooks/use-user-store";
import { t } from "@/lib/i18n";
import { filterHidden } from "@/lib/hidden-sessions";
import { notifySessionsMutated } from "@/lib/session-cache";
import { format } from "date-fns";

const TYPE_ICON: Record<SessionType, typeof BookOpen> = {
  LECTURE: BookOpen,
  ASSIGNMENT: FileText,
  EXAM: GraduationCap,
  TASK: Sparkles,
  DND: CalendarClock,
};

/** Catalogue keys for the type line under the title. */
const TYPE_LABEL: Record<SessionType, string> = {
  LECTURE: "Lecture",
  ASSIGNMENT: "Assignment",
  EXAM: "Exam",
  TASK: "Study",
  DND: "Busy",
};

/** A short countdown to `start`, rounded to 5 minutes. */
function untilLabel(start: Date, now: Date): string {
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000 / 5) * 5;
  if (minutes <= 0) return t("Now");
  if (minutes < 60) return t("In {minutes} min", { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0
    ? t("In {hours} h", { hours })
    : t("In {hours} h {minutes} min", { hours, minutes: rest });
}

function Later({ items, tz }: { items: TodayItem[]; tz: string }) {
  if (items.length === 0) return null;
  return (
    <View className="flex-row gap-2">
      {items.slice(0, 3).map((item) => {
        const Icon = TYPE_ICON[item.type];
        return (
          <View
            key={item.id}
            className="w-24 gap-1 rounded-2xl bg-white/50 px-3 py-2 dark:bg-white/10"
          >
            <Text className="text-xs opacity-70">
              {format(zonedDate(item.start, tz), "HH:mm")}
            </Text>
            <Icon size={16} />
            <Text className="text-xs font-medium" numberOfLines={1}>
              {item.title}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/**
 * The day at a glance, laid out like a weather widget: the current item large
 * with its countdown, and the next few items as small tiles below. Mirrors the
 * PWA card; both read the same `buildToday` model from `@zenflow/core`.
 */
export function TodayCard() {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const now = useNow();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState(false);

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

  if (!sessions) return null;

  const view: TodayView = buildToday(sessions, now, tz);
  const next = view.next;

  if (!next) {
    return (
      <Glass radius={20} style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-xs opacity-70">{t("Today")}</Text>
            <Text className="text-base font-semibold">{t("Nothing left today")}</Text>
          </View>
          <EmptyMark size={48} />
        </View>
      </Glass>
    );
  }

  const tone = SESSION_TONE_CLASSES[sessionTone(deriveState({ type: next.type }))];
  const Icon = TYPE_ICON[next.type];
  const started = next.start.getTime() <= now.getTime();

  async function start() {
    if (!next || busy) return;
    setBusy(true);
    try {
      await recordSessionStart(next.id);
      notifySessionsMutated();
      await load();
    } catch {
      // A failed start is not user-visible; the session stays as it was.
    } finally {
      setBusy(false);
    }
  }

  return (
    <Glass radius={24} style={{ padding: 20, gap: 16 }}>
      <View className="flex-row items-center justify-between gap-3">
        <View className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${tone.badge}`}>
          <Icon size={14} />
          <Text className="text-xs font-medium">{t(started ? "On now" : "Up next")}</Text>
        </View>
        <Text className="text-sm font-medium opacity-80">{untilLabel(next.start, now)}</Text>
      </View>

      <View className="gap-1">
        <Text className="text-3xl font-semibold" numberOfLines={1}>
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("Start")}
          disabled={busy}
          onPress={start}
          className="flex-row items-center gap-1.5 rounded-full bg-primary px-4 py-2 active:opacity-80"
        >
          <Play size={16} />
          <Text className="text-sm font-medium">{t("Start")}</Text>
        </Pressable>
      </View>
    </Glass>
  );
}
