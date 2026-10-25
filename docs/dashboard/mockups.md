# Dashboard mockups

Screens in `dashboard/mockups/`. Each field is named after a source that exists today. No student identifiers.

## Engagement

| Shown | Source | Gap |
| --- | --- | --- |
| Daily and weekly active | `ActiveUsersService`, Redis HyperLogLog per UTC day | Counts expire after 8 days; the line chart spans 8 days |
| Weekly retention | `User.createdAt` cohorts, `ClientEvent` APP_OPEN per week | Needs an aggregate query |
| Current streaks | Consecutive UTC days with an APP_OPEN | Needs a daily snapshot table for history |

## Learning quality

Per `SchedulingModel`, as in `backend/scripts/ab-report.ts`, PYTHON placements only.

| Shown | Source |
| --- | --- |
| Kept | `SlotProposal.acceptedUnmodified` over proposals |
| Settled | `SessionEvent` KEPT over placed sessions whose slot has passed |
| Drag | Mean of `abs(SessionEvent.dragDistanceMinutes)` on MOVE |
| Reward | Mean `SessionEvent.rewardScore` |
| Weekly kept | `SlotProposal` by `date_trunc('week', timestamp)` |

Completion is not shown. Only KEPT and MOVE are tracked ([ADR-0042](../adr/0042-kept-and-moved-signals.md)).

## Workload

`Session.durationMinutes` summed by weekday and hour of `scheduledStartTime`, grouped by `StudentProfile.faculty`, `className` or `cohort`. Groups under 5 students are hidden.

## Endpoints

Read-only, `CookieAuthGuard` then `AdminGuard` (403 for non-admins). DTOs in `packages/shared/src/admin.ts`.

| Route | Returns |
| --- | --- |
| `GET /admin/engagement` | `EngagementResponse` |
| `GET /admin/learning-quality` | `LearningQualityResponse` |
| `GET /admin/workload` | `WorkloadResponse`, all three dimensions |

Grant the role in the database. No API sets it:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE email = '<email>';
```
