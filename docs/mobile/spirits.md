# Spirits (Linh thú)

Dev-facing design for the collectible spirits that replace Blips. Art: [mockups/spirits.html](../../mockups/spirits.html). Landing roster: [usezenflow/landing](https://github.com/usezenflow/landing) `src/content/spirits.ts`. Parts library: #259.

## Rules

- Scheduling, DLU sync and reminders stay free for everyone. Spirits add convenience and status only.
- Spirits hatch from finished tasks and streaks, never from payment.
- Abilities act through existing features (scheduler, ingestion, reminders). None bypass placement invariants.

## Roster, season one

| No | Spirit | Element | Rarity | Weight |
|---|---|---|---|---|
| 001 | Cửu vĩ hồ, flame fox | Hỏa | Rare | 2 |
| 002 | Phong lang, storm wolf | Phong | Epic | 3 |
| 003 | Thủy xà, tide serpent | Thủy | Rare | 2 |
| 004 | Mộc lộc, thorn stag | Mộc | Common | 1 |
| 005 | Băng cú, frost owl | Băng | Common | 1 |
| 006 | Lôi miêu, volt lynx | Lôi | Rare | 2 |
| 007 | Ảnh báo, umbra panther | Ảnh | Epic | 3 |
| 008 | Nhật phượng, sunrise phoenix | Nhật | Legendary | 5 |

Rarity weights: common 1, rare 2, epic 3, legendary 5. Each spirit has three stages: egg, hatchling, ascended.

## Power

Power is the sum of rarity weights over spirits the student owns. Season one maxes at 19.

| Power | Perk key | Account perk |
|---|---|---|
| 3 | `examRadar` | Exam radar: a suggested start date for each new exam |
| 6 | `smartPlans` | Smart plans: a ready-made plan for each new exam and assignment, already placed |
| 10 | `focusMode` | Focus mode: notifications silenced during study blocks |
| 14 | `askZendeck` | Ask Zendeck in Zalo or Messenger to add, move or finish plans, and connect AI tools |
| 19 | `seasonCrown` | Season crown: season title, profile badge, early access to the next season |

- Chat quota: 10 messages a day per power point. It caps AI cost per student.
- Perks unlock on reaching the threshold and stay for the season.

## Equipped abilities

One equip slot at the start, a second at 6 spirits owned. Each spirit gives one ability while equipped.

| Spirit | Ability | Effect | Built on |
|---|---|---|---|
| Cửu vĩ hồ | Rescue | One tap rebuilds the plan for an overdue task before its deadline | Scheduler replan |
| Phong lang | Exam pack | Books prep before each new exam automatically | Ingestion, prep plans |
| Thủy xà | Reflow | Reflows the rest of the week when a class moves or a block is skipped | Scheduler replan |
| Mộc lộc | Roots | Keeps one chosen weekly time free for study | Session series |
| Băng cú | Focus guard | Mutes notifications during study blocks | Reminders, device push |
| Lôi miêu | Quick capture | Turns a forwarded LMS link or message into a task | Ingestion |
| Ảnh báo | Weekly recap | Sunday summary of starts and plans kept | Streaks, session events |
| Nhật phượng | Rebirth | Restores a broken streak once a month | Streaks |

## Chat and MCP

- Students meet chat through Zalo or Messenger, with the equipped spirit as the voice. No MCP setup needed.
- MCP is the route for students who connect Claude or ChatGPT. It exposes the same task and schedule actions as chat.
- Both share the power-based daily quota.

## Art

- Side view, facing right, flat fills, curves only, no outlines.
- Every shape has a role class (`b` body, `s` far side, `h` highlight, `a` accent, `e` eye, `t` teeth) and reads its colour from a variable, so one drawing renders in colour or locked.
- The logo curve sits on each flank as the flow mark.
- Locked spirits: warm ink body, umber far side and flow mark, cream eyes.
- Motion is CSS on named parts (`sway`, `flap`, `flick`) and stops under Reduce Motion.

## Hatching

- Sparks come from starts. A linked prep plan checked off at or after its slot also sparks, once per plan. A completed LMS assignment sparks once, shared with its plan. Each adds one spark to the incubating egg, at most three a day (user tz) across both.
- An egg hatches at five sparks. Tap Hatch to roll the spirit.
- Rarer species hatch less often: a species' chance is proportional to 1 / rarity weight. Ten hatches without a legendary force the next one.
- Decision and contract: [ADR-0026](../adr/0026-spirit-eggs-and-sparks.md).

## Code

- `packages/spirits` (`@zenflow/spirits`) holds the art. `src/art.ts` is generated from the mockup by `scripts/generate-art.py` (`pnpm --filter @zenflow/spirits art`); edit the mockup, not the output.
- `renderSpirit(id, stage, mood, { dark })` returns static SVG for `egg`, `hatchling` (fox and wolf only) or `ascended`. `mood` is `calm` or `locked`.
- Backend: `backend/src/spirits` (`GET /spirits`, `POST /eggs/:id/hatch`). Roll and power logic is pure in `core/`.
- The Spirits tab (`mobile/app/(app)/spirits.tsx`) shows the egg, the companion, perks and the collection. Unowned spirits stay unnamed.
