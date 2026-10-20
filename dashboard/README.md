# Zenflow dashboard

Management dashboard for [issue 276](https://github.com/usezenflow/zenflow/issues/276): engagement, learning quality and workload. React 19, Vite and PWA, styled like `pwa/`. Today it holds mockups only, built on fixtures. No backend calls.

## Run

```bash
pnpm --filter dashboard dev        # http://localhost:5174
pnpm --filter dashboard build | typecheck | lint
```

Deploy: `pnpm --filter dashboard build && pnpm --filter dashboard deploy` (Cloudflare Workers, same as pwa).

Add `?state=loading` or `?state=empty` to a screen, or use the top bar, to preview those states.

## Layout

| Path | Holds |
| --- | --- |
| `mockups/` | One screen per view and `fixtures.ts` |
| `src/` | App shell, theme, shared UI |

Every fixture field maps to an existing column or query. Sources and gaps: [docs/dashboard/mockups.md](../docs/dashboard/mockups.md).
