# Command palette

One free-text field on the home screen. Decision: [ADR-0048](../adr/0048-free-text-command-palette.md).

| Part | File |
| --- | --- |
| Verbs, ranges, checks | `mobile/lib/palette/command.ts`, `verbs.ts` |
| Local reading of a line | `mobile/lib/palette/understand.ts` |
| Learned changes and ranking | `mobile/lib/palette/edits.ts`, `history.ts` |
| Items sent to the server | `mobile/lib/palette/items.ts`, `split-long.ts` |
| Day and time sheet | `mobile/components/palette/when-sheet.tsx`, `lib/palette/when.ts` |
| Menus, sheets, previews | `mobile/components/palette/` |
| Backup endpoints | `backend/src/users/palette.service.ts` |

No model. Verbs match only as the first word. No verb means add.

**Add:** one line per task; new lines, `;` and `, ` start a new task, and each task is read on its own. Each line is read for a length (`30m`, `1h30`, `2 hours`), a day (today, `fri`, `3/11`), a clock time (`7pm`, `19:30`) and a part of the day, in any order. Slang and dictation work too (`trc t6`, `thu 2`, `7 gio toi`, `2 tieng ruoi`, `ba muoi phut`, `7 p.m.`). `every mon 6pm` or `moi ngay` repeat (with a time a fixed busy series, without one a task per day for a week or per week for a month); `6h in 2 blocks` or `chia 2 buoi` cuts a task into blocks (up to 3); `thang 12` and `5 thang 12` are dates; `after fri 3pm`, `sau t4` and `no sooner than 3pm` set the earliest start; `at library` and `tai thu vien` set the location. While typing, each line is a card with what was read and no time; Send asks the scheduler where it lands and shows the slot. A day or time is the deadline. A length that does not fit the free time before its deadline opens the sprint sheet.

**Edit:** pick tasks with `@` (or "All matching"), then type a change (`+30m`, `tomorrow 7pm`, `morning`) or pick a field from the list. Send applies it and the undo toast reverts it.

**Dates:** deadline, not before and move use one sheet that blocks the past. View and recap may pick past ranges.

**Previews:** an add shows only the days that receive a task. A replan shows a column per day, hatched where tasks move.

Tests: `mobile/lib/__tests__/palette-*.test.ts`.

The mockup is split into `mockups/command-palette/*.html`; run `pnpm build:palette` in `mockups/` to rebuild `command-palette.html`.
