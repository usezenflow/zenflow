# ADR-0031: Default commute from home

**Status:** accepted
**Date:** 2026-10-19
**Issue:** none

## Context
- ADR-0029 stores a commute per session, set by the student in the route planner. Every class needed it again, so most had none and the scheduler placed work with no travel time.
- The timetable already names the campus room, which maps to coordinates.

## Decision
- `User.homeLocation`, `homeLat`, `homeLng` (nullable) join `defaultTransport`. `PATCH /users/update/basic-info` sets or clears them together.
- `Session.commuteAuto` marks a commute the server filled. Editing the origin or minutes through `PATCH /sessions/:id` clears it.
- `CommuteDefaultsService` (`backend/src/commute`) fills a session that has a place and no origin and no minutes: origin is the home, minutes come from `PlacesService.route` with the shared vehicle table (`@zenflow/shared` `VEHICLES`). One route per destination. The place is the pinned point, else `resolveCampusPlace`.
- Students may not ride into the campus on a motorbike or bike. `GET /places/commute` (`PlacesService.commute`) rides to the library parking (`TWO_WHEEL_ENTRIES`), then walks to the room. A car drives onto the campus to the room. Minutes are both legs and the route planner draws both and names the parking. A walking vehicle, a start on campus or a place off campus is one leg.
- It runs after a materializer run that created or updated rows, and after a home or vehicle change, which also redoes rows with `commuteAuto`. It reads every session of the student in pages, past ones included, so setting a home backfills the whole timetable.
- Clearing the home resets the rows it filled.
- Campus places and the vehicle table move from `@zenflow/core` and the app into `@zenflow/shared`; core re-exports the places.
- The route planner starts From at the home. Settings, Travel sets home and vehicle.

## Consequences
- A synced timetable shows buffers with no taps; a student who does not want one removes the home.
- A student who clears one session's start gets it filled again on the next run.
- Rows are written without a `SessionEvent`, as for other system fields.
- Migration `home_location_commute_auto` and `drop_spirits_and_streaks`.
