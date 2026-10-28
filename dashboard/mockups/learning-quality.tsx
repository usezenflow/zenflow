import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { Shell } from "@/components/shell";
import { Card, Empty, LoadingGrid, Stat } from "@/components/ui";
import { pct } from "@/lib/format";
import { useViewState } from "@/lib/view-state";
import { settledKeptRate, keptRate, learning, type Policy, type SettledEvent } from "./fixtures";

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };
const TIP = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 };
const COLOR: Record<Policy, string> = { HEURISTIC: "var(--chart-2)", LINUCB: "var(--chart-1)" };
const NAME: Record<Policy, string> = { HEURISTIC: "Heuristic", LINUCB: "LinUCB" };
const EVENTS: [SettledEvent, string][] = [
  ["KEPT", "Kept at start"],
  ["MOVE", "Moved"],
];

export function LearningQuality() {
  const [state] = useViewState();
  const weeks = [...new Set(learning.weekly.map((w) => w.week))].map((week) => {
    const row: Record<string, string | number> = { week };
    for (const w of learning.weekly.filter((x) => x.week === week)) row[w.policy] = keptRate(w) * 100;
    return row;
  });
  const events = EVENTS.map(([key, label]) => {
    const row: Record<string, string | number> = { event: label };
    for (const p of learning.policies) row[p.policy] = p.events[key];
    return row;
  });
  return (
    <Shell title="Learning quality" subtitle="Kept, settled and drag minutes per policy">
      {state === "loading" && <LoadingGrid tiles={4} />}
      {state === "empty" && <Empty title="No proposals yet" body="Results appear after students get placements." />}
      {state === "ready" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {learning.policies.map((p) => (
              <div key={p.policy} className="rounded-xl border bg-card p-5">
                <div className="mb-4 flex items-center gap-2">
                  <span className="size-2.5 rounded-full" style={{ background: COLOR[p.policy] }} />
                  <h2 className="text-sm font-semibold">{NAME[p.policy]}</h2>
                  <span className="ml-auto text-xs text-muted-foreground">{p.proposals.toLocaleString()} proposals</span>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <Stat label="Kept" value={pct(keptRate(p))} hint="Accepted unmodified" />
                  <Stat label="Settled" value={pct(settledKeptRate(p))} hint="Of sessions whose slot has passed" />
                  <Stat label="Drag" value={`${p.dragMinutes} min`} hint="Average per move" />
                </div>
              </div>
            ))}
          </div>
          <Card title="Kept rate by week" hint="Proposals accepted without a change">
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={weeks} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="week" tickFormatter={(d: string) => format(new Date(d), "d MMM")} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis domain={[40, 80]} unit="%" tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={TIP} formatter={(v: number) => `${v.toFixed(0)}%`} />
                  <Legend />
                  {learning.policies.map((p) => (
                    <Line isAnimationActive={false} key={p.policy} dataKey={p.policy} name={NAME[p.policy]} stroke={COLOR[p.policy]} strokeWidth={2} dot={{ r: 3 }} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card title="Session outcomes" hint="Events recorded per policy">
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={events} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="event" tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={TIP} />
                  <Legend />
                  {learning.policies.map((p) => (
                    <Bar isAnimationActive={false} key={p.policy} dataKey={p.policy} name={NAME[p.policy]} fill={COLOR[p.policy]} radius={4} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </div>
      )}
    </Shell>
  );
}
