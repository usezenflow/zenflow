import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Activity, Flame, LayoutGrid, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTheme, useTheme } from "@/lib/theme";
import { useViewState, type ViewState } from "@/lib/view-state";

const NAV = [
  { to: "/engagement", label: "Engagement", icon: Flame },
  { to: "/learning-quality", label: "Learning quality", icon: Activity },
  { to: "/workload", label: "Workload", icon: LayoutGrid },
];

const STATE_LABEL: Record<ViewState, string> = {
  ready: "Data",
  loading: "Loading",
  empty: "Empty",
};

export function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  const theme = useTheme();
  const [state, setState] = useViewState();
  const dark = theme === "dark";
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground md:flex-row">
      <nav className="flex gap-1 border-b bg-sidebar p-2 md:w-56 md:flex-col md:border-r md:border-b-0 md:p-4">
        <p className="hidden px-3 pb-3 text-sm font-semibold md:block">Zenflow dashboard</p>
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm",
                isActive ? "bg-sidebar-accent font-medium" : "text-muted-foreground hover:bg-sidebar-accent",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
      </nav>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border p-0.5 text-xs" role="group" aria-label="Preview state">
              {(Object.keys(STATE_LABEL) as ViewState[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setState(s)}
                  className={cn("rounded px-2.5 py-1", state === s ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  {STATE_LABEL[s]}
                </button>
              ))}
            </div>
            <button
              type="button"
              aria-label={dark ? "Use light theme" : "Use dark theme"}
              onClick={() => setTheme(dark ? "light" : "dark")}
              className="rounded-md border p-2"
            >
              {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </button>
          </div>
        </div>
        {children}
      </main>
    </div>
  );
}
