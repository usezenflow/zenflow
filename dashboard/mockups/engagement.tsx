import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { format } from "date-fns";
import { Shell } from "@/components/shell";
import { Card, Empty, LoadingGrid, Stat } from "@/components/ui";
import { pct } from "@/lib/format";
import { useViewState } from "@/lib/view-state";
import { engagement } from "./fixtures";

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };

function shade(v: number | null) {
  if (v === null) return undefined;
  return `color-mix(in oklch, var(--brand-orange) ${Math.round(v * 80)}%, transparent)`;
}

export function Engagement() {
  const [state] = useViewState();
  const e = engagement;
  return (
    <Shell title="Engagement" subtitle="Active students, retention and streaks">
      {state === "loading" && <LoadingGrid />}
      {state === "empty" && <Empty title="No activity yet" body="Counts appear after students open the app." />}
      {state === "ready" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Daily active" value={String(e.dau)} hint="Today, UTC" />
            <Stat label="Weekly active" value={String(e.wau)} hint="Last 7 days" />
            <Stat label="Stickiness" value={pct(e.dau / e.wau)} hint="Daily over weekly" />
          </div>
          <Card title="Daily active students" hint="Eight days are kept, then the counts expire">
            <div className="h-64">
              <ResponsiveContainer>
                <LineChart data={e.activeDays} margin={{ left: -16, right: 8 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tickFormatter={(d: string) => format(new Date(d), "d MMM")} tick={AXIS} axisLine={false} tickLine={false} />
                  <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                  <Line isAnimationActive={false} dataKey="dau" name="Students" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-5">
            <Card title="Weekly retention" hint="Share of each sign up week that opened the app" className="lg:col-span-3">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-xs tabular-nums">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1 text-left font-normal">Joined</th>
                      <th className="py-1 text-right font-normal">Students</th>
                      {e.retention[0].weeks.map((_, w) => (
                        <th key={w} className="py-1 text-center font-normal">{`Week ${w}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {e.retention.map((c) => (
                      <tr key={c.cohortWeek}>
                        <td className="py-1">{format(new Date(c.cohortWeek), "d MMM")}</td>
                        <td className="py-1 text-right">{c.size}</td>
                        {c.weeks.map((v, w) => (
                          <td key={w} className="p-0.5">
                            <div className="rounded py-1.5 text-center" style={{ background: shade(v) }}>
                              {v === null ? "" : pct(v)}
                            </div>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
            <Card title="Current streaks" hint="Consecutive days with an app open" className="lg:col-span-2">
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart data={e.streaks} layout="vertical" margin={{ left: 8, right: 8 }}>
                    <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="days" tick={AXIS} axisLine={false} tickLine={false} width={80} />
                    <Tooltip cursor={{ fill: "var(--muted)" }} contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                    <Bar isAnimationActive={false} dataKey="users" name="Students" fill="var(--chart-1)" radius={4} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}
