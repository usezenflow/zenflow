# ADR-0044: MCP planning tools and forced preview

**Status:** accepted
**Date:** 2026-10-27
**Issue:** none

## Context
- Assistants guessed dates, wrote without showing the user, and could only place one task at a time.
- The pasted prompt listed tools that already describe themselves, and personal `zf_` tokens duplicated OAuth.

## Decision
- **Instructions.** `McpServerFactory` sends `buildApiAccessPrompt` as the server `instructions`, per `User.lang` and timezone. No paste. The server also advertises its name, site and logo (`PublicUrls.web` + `/pwa-512x512.png`).
- **Forced preview.** `create_tasks`, `update_session`, `delete_sessions` and `replan` take an optional `planId`. Without it they only preview and return one. With it they apply the same arguments. `planId` is `<expiry>.<HMAC(user, tool, canonical args)>`, valid 10 minutes, keyed by the API token pepper (a per-process key when unset). Stateless, so any instance verifies it.
- **Tools.** `get_time` (now, week, 14-day table), `recap` (per-day load, busy-hour heatmap, deadlines, gaps, optional `rhythm` once the preference matrix exists), `find_free_slots` (07:00 to 22:00 gaps), `replan`.
- **Replan.** `ReplanService` re-places every future standalone `TASK` in a range, least slack first (`deadline - max(now, notBefore) - duration`, ties longer first), each scored by LinUCB against the calendar minus the replanned tasks plus the slots already claimed. `change: balanced` keeps the old start as the stability anchor, `free` drops it. Nothing is pinned. Moves are written as `SYSTEM_MOVE` events in one undo group, so the bandit learns nothing from them and `undo_last_change` reverts the lot.
- **Bounds.** `Session.notBefore` (timestamp) and `Session.window` (`MORNING`, `AFTERNOON`, `EVENING`, local 06 to 12, 12 to 18, 18 to 24) on `TASK`. The placer sees them as extra occupied time (`constraint-blocks.ts`), so the Python contract, the frozen TS fallback and the golden fixtures are unchanged. Create and update reject bounds no start can satisfy. A manual move outside a bound drops that bound.
- **Dry run output.** `PROPOSED` items add `localStart` and `warnings` (odd hour, weekend, near deadline, overlap).
- **Tokens.** Personal `zf_` tokens, their routes, the `ApiToken` table and the settings UI are removed. `ApiTokensService` only resolves OAuth access tokens.
- **Contract.** `@zenflow/shared`: `SESSION_WINDOWS`, `SessionWindow`, `SESSION_WINDOW_HOURS`, optional `notBefore` and `window` on `Session`, create and update inputs; `ApiAccessResponse.tokens` removed. Migrations `20261027090000_task_window`, `20261027100000_drop_api_token`.

## Consequences
- An assistant cannot write without a preview the user can read.
- A task displaced while placing another ignores its own bounds (the placer's flexible wire has none).
- The frozen TS fallback ignores bounds and claimed slots, so a replan during a Python outage can place against stale occupancy.
- Replan scores one task at a time, about 10 ms each, capped at 60 tasks.
- Scripts that used `zf_` tokens stop working.
