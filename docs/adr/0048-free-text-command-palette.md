# ADR-0048: Free text command palette

**Status:** accepted
**Date:** 2026-10-27
**Issue:** none

## Context
Typed lists and length tokens add friction. A model call costs money and needs a network, and free-form queries were unreliable.

## Decision
- One field with a verb first word, then chips and autocomplete for ranges, lengths and `@` targets. No model and no free-form queries. Add and edit read each line locally for a length, a day, a clock time and a part of the day from closed word lists in English and Vietnamese (`understand.ts`), tint what was read in the text and send the rest as the title. No chips sit above the keyboard. Length is never asked: typed, else the title's median, else the type default.
- The bulk dry run and DTO validation still gate every write. Silent add needs a typed or learned length.
- A `TASK` over `MAX_TASK_MINUTES` splits into at most `MAX_SPLIT_CHUNKS` flexible tasks over equal sub-windows; no backend change.
- Learned state (`history.ts`) lives in MMKV per user and is backed up as an opaque blob: `User.paletteData` (bytea), `paletteUpdatedAt`, global Prisma `omit` for the column.
- `GET /users/me/palette` returns the bytes with `ETag` (epoch ms), 204 when empty. `PUT` takes `application/octet-stream` up to 100 KB (413 above) and requires `If-Match` (`0` when empty); a stale tag gets 412 and the client refetches, merges by union and retries.

- `POST /sessions/bulk` `CREATED` results gain optional `pairwise {slotProposalId, primary, alternative}` when the two policies differ by at least an hour; `POST /sessions/:id/slot-pick` records the pick.

## Consequences
- Anything outside the fixed word list stays in the title; the preview is the safety net.
- Candidates are picked greedily, not by weighted interval scheduling.
- A bare weekday equal to today means next week.
- A fixed or repeating `TASK` still needs DTO and series work; a stated start on a flexible task becomes `notBefore`.
- Migration `20261027120000_user_palette_data` adds two nullable columns.
