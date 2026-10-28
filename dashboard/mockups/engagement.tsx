import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { Shell } from "@/components/shell";
import { Card, Empty, LoadingGrid, Stat } from "@/components/ui";
import { pct } from "@/lib/format";
import { useViewState } from "@/lib/view-state";
import { engagement } from "./fixtures";

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" };

export function Engagement() {
  const [state] = useViewState();
  const e = engagement;
  return (
    <Shell title="Engagement" subtitle="Active students">
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
        </div>
      )}
    </Shell>
  );
}
