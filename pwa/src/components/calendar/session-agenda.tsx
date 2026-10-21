import { searchSessions } from "@/api/tasks";
import { EmptyMark, ErrorMark, NoResultsMark } from "@/components/brand/state-marks";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Glass } from "@/components/ui/glass";
import { Input } from "@/components/ui/input";
import { useUserStore } from "@/hooks/use-user-store";
import { highlightParts } from "@/lib/highlight";
import {
  dayLabel,
  flattenDayGroups,
  groupSessionsByDay,
  mergeSearchPage,
  type SearchListRow,
  sessionTimeRange,
} from "@/lib/session-search-list";
import { cn } from "@/lib/utils";
import {
  deriveState,
  isOnlineLocation,
  SESSION_TONE_CLASSES,
  sessionTone,
  splitZoned,
} from "@zenflow/core";
import type { Session, SessionSearchDirection } from "@zenflow/shared";
import { Globe, MapPin, Search } from "lucide-react";
import { t } from "@/lib/i18n";
import { errorToast } from "@/lib/toast";
import { filterHidden, useHiddenVersion } from "@/lib/hidden-sessions";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 20;

type Status = "loading" | "ready" | "failed";

function AgendaRow({
  session,
  tz,
  term,
}: {
  session: Session;
  tz: string;
  term: string;
}) {
  const tone = sessionTone(deriveState(session), session.late);
  const location = session.location?.trim();
  const online = location ? isOnlineLocation(location) : false;
  const LocationIcon = online ? Globe : MapPin;
  const [start, end] = sessionTimeRange(session, tz);

  return (
    <button
      type="button"
      onClick={() =>
        window.dispatchEvent(
          new CustomEvent("zenflow:open-task", { detail: session.id }),
        )
      }
      className="flex w-full min-w-0 items-stretch gap-3 rounded-r-xl py-2 pr-2 text-left transition-colors hover:bg-muted/60"
    >
      <span
        aria-hidden
        className={cn(
          "w-[3px] shrink-0 rounded-full",
          SESSION_TONE_CLASSES[tone].dot,
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-1.5 text-[12px] tabular-nums text-muted-foreground">
          <span>{start}</span>
          <span className="opacity-60">{end}</span>
        </span>
        <span className="truncate text-[15px] font-medium">
          {highlightParts(session.title, term).map((part, i) =>
            part.match ? (
              <mark
                key={i}
                className="rounded-[4px] bg-brand-orange/40 font-bold text-inherit"
              >
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </span>
        {location ? (
          <Glass
            frosted
            className="mt-1 flex w-fit max-w-[260px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium text-muted-foreground"
          >
            <LocationIcon className="size-3 shrink-0" />
            <span className="truncate">{online ? t("Online") : location}</span>
          </Glass>
        ) : null}
      </span>
    </button>
  );
}

/**
 * Searchable agenda of the user's sessions, the web twin of mobile's List tab:
 * day headers, rows in ascending order, pages loading both ways around today.
 * `term` filters it through the search API.
 */
export function SessionAgenda() {
  const tz = useUserStore((s) => s.user?.timezone) || "UTC";
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [anchor] = useState(() => new Date().toISOString());
  const hiddenVersion = useHiddenVersion();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [paging, setPaging] = useState<SessionSearchDirection | null>(null);
  const cursors = useRef<Record<SessionSearchDirection, string | null>>({
    forward: null,
    backward: null,
  });
  const generation = useRef(0);
  const todayRef = useRef<HTMLDivElement>(null);
  const placed = useRef(false);

  // Typing filters after a short pause so each keystroke does not hit the API.
  useEffect(() => {
    const id = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(id);
  }, [query]);

  const reload = useCallback(() => {
    const gen = ++generation.current;
    const q = term || undefined;
    setStatus("loading");
    placed.current = false;
    Promise.all([
      searchSessions({ q, anchor, direction: "backward", limit: PAGE_SIZE }),
      searchSessions({ q, anchor, direction: "forward", limit: PAGE_SIZE }),
    ])
      .then(([before, after]) => {
        if (gen !== generation.current) return;
        cursors.current = { backward: before.nextCursor, forward: after.nextCursor };
        setSessions(
          filterHidden(
            mergeSearchPage(
              mergeSearchPage([], before.sessions, "backward"),
              after.sessions,
              "forward",
            ),
          ),
        );
        setStatus("ready");
      })
      .catch(() => {
        if (gen === generation.current) setStatus("failed");
      });
  }, [term, anchor]);

  // Hiding or restoring a session (pending a delete's undo) reloads the rows.
  useEffect(() => {
    reload();
  }, [reload, hiddenVersion]);

  // A create, edit, move or delete anywhere refreshes the rows in place.
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener("zenflow:calendar-refresh", handler);
    window.addEventListener("zenflow:task-updated", handler);
    return () => {
      window.removeEventListener("zenflow:calendar-refresh", handler);
      window.removeEventListener("zenflow:task-updated", handler);
    };
  }, [reload]);

  const loadMore = useCallback(
    (direction: SessionSearchDirection) => {
      const cursor = cursors.current[direction];
      if (status !== "ready" || !cursor || paging) return;
      const gen = generation.current;
      setPaging(direction);
      searchSessions({ q: term || undefined, cursor, direction, limit: PAGE_SIZE })
        .then((page) => {
          if (gen !== generation.current) return;
          cursors.current = { ...cursors.current, [direction]: page.nextCursor };
          setSessions((prev) => mergeSearchPage(prev, page.sessions, direction));
        })
        .catch(() => {
          if (gen === generation.current) errorToast(t("Couldn't load more sessions"));
        })
        .finally(() => {
          if (gen === generation.current) setPaging(null);
        });
    },
    [status, term, paging],
  );

  const rows = useMemo<SearchListRow[]>(
    () => flattenDayGroups(groupSessionsByDay(sessions, tz)),
    [sessions, tz],
  );

  // Open on today: the first day from today on, or the last row when all is past.
  const todayDate = splitZoned(anchor, tz).date;
  const todayIndex = rows.findIndex(
    (r) => r.kind === "day" && r.date >= todayDate,
  );

  useEffect(() => {
    if (status !== "ready" || placed.current) return;
    placed.current = true;
    todayRef.current?.scrollIntoView({ block: "start" });
  }, [status, rows.length]);

  const hasQuery = term.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("Search sessions")}
          aria-label={t("Search sessions")}
          className="h-9 rounded-full bg-card/70 pl-8 text-[13px]"
        />
      </div>

      {status === "failed" ? (
        <Empty className="border-0 p-4 md:p-4">
          <EmptyHeader>
            <EmptyMedia>
              <ErrorMark size={56} />
            </EmptyMedia>
            <EmptyTitle>{t("Couldn't search right now")}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {cursors.current.backward && status === "ready" ? (
          <button
            type="button"
            onClick={() => loadMore("backward")}
            disabled={paging !== null}
            className="w-full py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            {t("Load earlier")}
          </button>
        ) : null}

        {status === "ready" && rows.length === 0 ? (
          <Empty className="border-0 p-4 md:p-4">
            <EmptyHeader>
              <EmptyMedia>
                {hasQuery ? <NoResultsMark size={56} /> : <EmptyMark />}
              </EmptyMedia>
              <EmptyTitle>
                {hasQuery ? t("No sessions match") : t("No sessions yet")}
              </EmptyTitle>
              {hasQuery ? (
                <EmptyDescription>{t("Check the spelling or try a shorter word.")}</EmptyDescription>
              ) : null}
            </EmptyHeader>
          </Empty>
        ) : null}

        {rows.map((row, i) =>
          row.kind === "day" ? (
            <div
              key={row.key}
              ref={i === todayIndex ? todayRef : undefined}
              className="px-1 pt-4 pb-1 text-[13px] font-semibold text-muted-foreground"
            >
              {dayLabel(row.date)}
            </div>
          ) : (
            <AgendaRow key={row.key} session={row.session} tz={tz} term={term} />
          ),
        )}

        {cursors.current.forward && status === "ready" ? (
          <button
            type="button"
            onClick={() => loadMore("forward")}
            disabled={paging !== null}
            className="w-full py-3 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            {t("Load more")}
          </button>
        ) : null}

        {status === "loading" ? (
          <p className="px-1 py-4 text-[13px] text-muted-foreground">{t("Loading")}</p>
        ) : null}
      </div>
    </div>
  );
}
