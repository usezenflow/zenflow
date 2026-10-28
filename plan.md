# Zenflow — Product Pivot & Engineering Direction

## 1. Your Role

Act as a senior backend engineer and pragmatic technical architect working on an existing production application.

Your task is to understand the current Zenflow codebase and help evolve it into an AI-first, calendar-native intelligent scheduling system.

**Do not start by rewriting the application.** First inspect the repository, understand the current architecture and implementation, identify what can be reused, and propose a phased migration plan.

Optimize for:
- Shipping a working product to real users quickly.
- Reusing existing, tested production code wherever possible.
- Reliable integrations, synchronization, and data consistency.
- Keeping the scheduling algorithm and thesis evaluation intact.
- Minimizing unnecessary frontend work and infrastructure complexity.
- Building a system that demonstrates genuine backend engineering quality.

Be critical. Do not blindly agree with the proposed architecture if the existing code reveals a better, simpler approach. Explain meaningful trade-offs before recommending changes.

---

## 2. Product Context

Zenflow is a student scheduling product currently deployed at:

https://usezenflow.com

It was originally designed as a mobile-first student LMS scheduler, built with React Native and Expo.

The original product included:
- Passwordless email OTP authentication.
- User onboarding and settings.
- LMS and university portal integrations.
- Assignment and timetable ingestion.
- Task creation and management.
- A scheduling engine that recommends suitable study times.
- Calendar-like UI and task rescheduling interactions.
- Notifications and scheduling preferences.
- An adaptive scheduling algorithm based on contextual bandits.

However, the original interaction model has a fundamental usability problem.

Users need to open another application, manually create or manage tasks, interact with scheduling controls, and maintain yet another calendar interface. Even the developer finds this workflow unnecessarily tedious.

Users already have calendar applications they are comfortable using. Building another complete calendar UI does not necessarily create enough additional value.

The product direction has therefore changed.

### New product vision

**Zenflow should become an AI-first scheduling engine that automatically gathers work, decides when it should be done, and synchronizes the resulting schedule into the user's existing calendar.**

The product should minimize the amount of work required from users rather than ask them to adopt another calendar application.

The intended experience:

1. Zenflow imports assignments and timetable information from supported university systems.
2. Users can create tasks or request schedule changes using natural language through an AI client connected via MCP.
3. Zenflow's backend validates the request and uses its scheduling engine to determine an appropriate schedule.
4. The resulting events are synchronized to Google Calendar.
5. Users view their schedule and receive ordinary event reminders through their existing calendar application.
6. Zenflow independently notifies users about meaningful changes that ordinary calendar reminders cannot cover.
7. User interactions can be recorded for algorithm evaluation and future improvements.

The core promise is:

**Users describe their work. Zenflow decides when to do it. Their existing calendar shows the result.**

This is a product pivot, not an invitation to rebuild the backend from scratch.

---

## 3. Target Architecture

Treat the following as the intended logical architecture, not an assumption that every component must be newly implemented.

### A. Ingestion layer

Responsibilities:
- Integrate with supported LMS platforms and university portals.
- Fetch assignments, deadlines, timetable events, and relevant changes.
- Normalize different source formats into a consistent internal representation.
- Track external identifiers and source metadata.
- Detect newly created, updated, cancelled, or deleted source records.
- Prevent duplicate imports.
- Handle authentication failures, retries, rate limits, and partial failures.

Important considerations:
- Preserve provenance: know which external system and record produced each item.
- Make ingestion idempotent wherever possible.
- Distinguish source records from user-created tasks.
- Do not assume every LMS provides reliable webhooks; polling may be necessary.
- Do not silently overwrite user changes without a clear conflict policy.

Inspect the existing LMS and portal integrations before proposing new abstractions.

### B. Scheduling engine

The scheduling engine is a core part of Zenflow's value and thesis.

It should remain a first-class backend component rather than being replaced by an LLM.

Responsibilities:
- Accept tasks, deadlines, durations, user preferences, workload, and scheduling constraints.
- Generate feasible candidate time slots.
- Select appropriate slots using the existing scheduling algorithm.
- Handle overlapping tasks, unavailable periods, deadlines, and rescheduling.
- Produce explainable, structured scheduling decisions.
- Persist relevant decision data for evaluation and debugging.

#### Existing algorithm context

Zenflow uses a contextual-bandit approach based on LinUCB, including a disjoint LinUCB implementation and an offline evaluator.

The system has used coarse time-of-day buckets:
- Early: 00:00–06:00
- Morning: 06:00–11:00
- Afternoon: 11:00–17:00
- Evening: 17:00–20:00
- Night: 20:00–24:00

Relevant context may include:
- Deadline and time remaining.
- Task duration.
- Title-derived features.
- Tags and task type.
- Day of week and weekday/weekend.
- Existing workload and schedule.
- User preference history.

The exact implementation may have evolved. Inspect the repository to establish the current truth before changing anything.

**Do not replace LinUCB with arbitrary LLM-generated timestamps.**

The AI layer may interpret user intent, extract task information, and translate requests into structured commands. The scheduling engine remains responsible for selecting valid slots under the application's constraints.

Keep the existing offline evaluator and heuristic baseline where they are useful for thesis evaluation. The heuristic baseline is primarily for comparison, not an excuse to silently downgrade production scheduling behavior.

If the scheduling engine cannot find a valid slot, return an explicit result or request clarification rather than silently scheduling an invalid event.

### C. Google Calendar integration

Google Calendar should be the first calendar integration.

Responsibilities:
- Google OAuth authorization and token management.
- Create calendar events from scheduled tasks.
- Update existing events when schedules change.
- Delete or cancel corresponding events when appropriate.
- Store mappings between internal task IDs and external calendar event IDs.
- Handle timezone conversion consistently.
- Prevent duplicate event creation.
- Support retries after transient API failures.
- Track synchronization status and surface actionable errors.
- Define what happens when users modify events directly in Google Calendar.

Design for reliable synchronization, not just successful API calls.

Consider:
- Idempotency.
- External event identifiers.
- Token refresh and revocation.
- API quotas and rate limits.
- Retry policies and backoff.
- Partial failure between database writes and external API calls.
- Reconciliation for missed updates.
- Concurrent updates and stale data.
- Deletion semantics.
- Timezone and daylight-saving behavior.

Do not assume a database transaction can atomically commit with a Google Calendar API request.

If appropriate for the existing architecture, consider an outbox or durable synchronization job model. Do not introduce a message broker or distributed workflow framework without demonstrating why the current infrastructure needs it.

The system should distinguish between:
1. The intended schedule stored by Zenflow.
2. The external event representing that schedule.
3. The synchronization status between them.

Define a reasonable initial source-of-truth and conflict-resolution policy. Avoid implementing bidirectional synchronization unless it is necessary for the MVP.

### D. MCP and AI interface

MCP provides an interface through which an AI client can operate Zenflow.

The initial goal is to expose useful operations without requiring Zenflow to build a custom conversational frontend.

Potential operations include:
- List upcoming tasks and deadlines.
- Create a task.
- Inspect a task or its scheduled slot.
- Request a reschedule.
- Mark a task as unavailable or update a constraint, if supported.
- Preview proposed schedule changes.
- Confirm a batch rescheduling operation.
- Inspect synchronization errors.

Example user requests:
- "Schedule this report before Friday's deadline."
- "Move my report to Thursday evening."
- "I'm busy all Monday next week. Reorganize my tasks."
- "What assignments do I need to finish this week?"
- "Why did you schedule this task at that time?"

The MCP layer should expose typed, validated operations backed by the existing Zenflow application services.

**Keep scheduling business logic inside the backend.** MCP tools should not duplicate scheduling algorithms or independently write arbitrary event times to Google Calendar.

Separate:
- Natural-language interpretation.
- Request validation.
- Scheduling decisions.
- Confirmation requirements.
- Persistence.
- External calendar synchronization.

For simple, unambiguous operations, execution may be direct. For large batch changes, significant deadline implications, or potentially destructive actions, provide a preview and require confirmation where appropriate.

Do not build a custom chatbot UI unless repository inspection reveals a compelling reason.

### E. Smart notifications

The objective is to notify users about meaningful information without duplicating every notification their calendar already provides.

Responsibility split:

**Google Calendar**
- Ordinary reminders for scheduled events.
- Event-start reminders.
- User-configured reminders supported by their calendar configuration.

**Zenflow**
- Newly discovered assignments.
- Important deadline or timetable changes.
- Class cancellations or significant source changes.
- Important schedule reoptimization results.
- Calendar synchronization failures that require user action.

Do not send a notification for every background synchronization or insignificant scheduling adjustment.

Inspect existing notification infrastructure and determine which delivery channels are actually available. Do not assume push notifications will work without a registered mobile application, device token, and delivery configuration.

For the initial release, a smaller set of reliable notifications is preferable to a broad notification system that is difficult to operate.

### F. Minimal web control plane

The web interface should focus on configuration and operational visibility rather than recreate a calendar application.

Likely responsibilities:
- Login and account management.
- Google Calendar OAuth connection.
- LMS and university portal connection settings.
- MCP setup instructions and authentication.
- Scheduling preferences and relevant constraints.
- Integration and synchronization status.
- Basic task inspection or troubleshooting where necessary.

Do not rebuild:
- A full calendar interface.
- A sophisticated drag-and-drop scheduler.
- A duplicate task-management application.
- A mobile widget solely to display information already available in Google Calendar.

Retain existing UI components when they remain useful. The mobile application may remain temporarily as a prototype or fallback during the transition, but it should not drive new product development unless real user evidence justifies it.

---

## 4. Data Model and Reliability Requirements

Inspect the existing database schema and migrations before proposing changes.

Preserve existing entities when their semantics remain appropriate.

Determine whether the current schema already supports:
- Users and authentication.
- Tasks and external source records.
- Assignments and timetable events.
- Scheduling preferences.
- Scheduled time slots.
- Calendar event mappings.
- Integration credentials and connection status.
- Scheduling decision logs.
- User interactions and rescheduling history.
- Notification delivery and deduplication.
- Synchronization attempts and errors.

Do not create a new table for every conceptual component. Propose only the minimum schema changes needed for the target behavior.

Pay special attention to:
- Stable internal IDs.
- Unique external source identifiers.
- Idempotent ingestion.
- Task lifecycle and deletion semantics.
- Calendar event lifecycle.
- Timezone-aware timestamps.
- Optimistic concurrency or stale-update detection where needed.
- Retry-safe background processing.
- Auditability of scheduling decisions.

Use the repository's existing database, ORM, migration conventions, queues, and infrastructure unless there is a concrete reason to change them.

Never perform destructive schema or data changes without explaining their consequences.

---

## 5. Thesis and Evaluation Requirements

Zenflow is also an undergraduate thesis project.

The adaptive scheduling algorithm is a core research component. Product simplification must not erase the algorithm or its evaluation methodology.

Preserve:
- The existing LinUCB implementation.
- Offline evaluation.
- The heuristic baseline.
- Relevant experiment configurations and metrics.
- Production scheduling decision logs.
- User interaction and rescheduling events when available.

The production system may use LinUCB exclusively if that is supported by the current evaluation. Keep the baseline available for controlled offline comparisons.

Record enough structured information to investigate scheduling behavior, such as:
- Task and context features used in a decision.
- Candidate slots considered.
- Selected slot.
- Algorithm and model version.
- Relevant constraints.
- Decision timestamp.
- Subsequent user rescheduling or other available feedback.
- Calendar synchronization outcome.

Avoid collecting full chat transcripts by default when structured action records are sufficient.

Do not assume every interaction provides a valid reward label. A user moving an event may indicate dissatisfaction, changed circumstances, or a new constraint.

Keep offline algorithm evaluation separate from claims about real-world user outcomes. Production logs can provide evidence of adoption, synchronization reliability, and interaction patterns, but they do not automatically establish that LinUCB improves academic performance.

The product UI A/B test is no longer a primary requirement because the custom scheduling interface is being removed. Do not introduce new experimentation infrastructure unless the existing thesis methodology requires it.

---

## 6. Implementation Strategy

Use a phased, incremental migration.

### Phase 0 — Repository reconnaissance

Before changing code:
1. Inspect the repository structure, README, architecture documentation, and package manifests.
2. Identify the backend, frontend, database, migration system, background workers, queues, and deployment configuration.
3. Trace the current task lifecycle from ingestion or creation through scheduling and persistence.
4. Locate the LinUCB implementation and offline evaluation.
5. Inspect all existing LMS and portal integrations.
6. Inspect authentication and OAuth-related code.
7. Inspect notification delivery and existing scheduling jobs.
8. Identify current tests and how integration tests are run.
9. Identify existing deployment and production constraints.

Report what already exists and what is missing. Distinguish verified implementation from assumptions.

### Phase 1 — Establish the minimal vertical slice

Target flow:

User or integration creates a task
→ backend validates and persists it
→ scheduling engine selects a feasible slot
→ internal schedule is saved
→ Google Calendar event is created
→ synchronization status is recorded
→ user can see the event in their existing calendar.

Prioritize this end-to-end path over implementing many isolated features.

Use existing integrations and services wherever possible.

### Phase 2 — Reliable calendar lifecycle

Implement the minimum reliable behavior for:
- Creating events.
- Updating events.
- Handling rescheduling.
- Handling cancellation or deletion.
- Token refresh and authorization failures.
- Retryable versus permanent API errors.
- Duplicate prevention.
- Reconciliation and observable sync status.

Test partial failures, not only the happy path.

### Phase 3 — MCP interface

Expose the most useful typed operations for task creation, inspection, and rescheduling.

Reuse backend services rather than implementing separate MCP-specific business logic.

Validate inputs, enforce authorization, and ensure tools cannot operate on another user's data.

Introduce preview/confirmation for consequential batch changes where needed.

### Phase 4 — Ingestion and smart notifications

Harden existing LMS and portal integrations. Prioritize the source with the strongest real user value and the lowest integration cost.

Add event-change detection and only the notification flows that provide meaningful value beyond calendar reminders.

### Phase 5 — Simplify the user-facing application

Identify which existing mobile and web features can be:
- Reused for account and integration settings.
- Reduced to a simple configuration page.
- Retained temporarily.
- Archived after the replacement workflow is verified.

Do not remove working functionality until dependencies, production users, authentication flows, and migration consequences are understood.

---

## 7. Engineering Standards

Follow the existing project conventions and be pragmatic.

- Prefer small, reviewable changes over broad rewrites.
- Preserve backward compatibility where practical.
- Add tests for meaningful behavior changes.
- Use real dependencies in integration tests where the behavior depends on databases, transactions, queues, or external API contracts.
- Mock external services only when appropriate; do not confuse mocked tests with proof of end-to-end reliability.
- Test idempotency, concurrency, retries, stale updates, and partial failures where relevant.
- Validate authorization at the backend boundary.
- Keep secrets out of source control and logs.
- Avoid unnecessary abstractions, services, and infrastructure.
- Do not introduce a new framework solely because it is popular.
- Document important architectural decisions and trade-offs.
- Preserve existing production behavior unless the migration explicitly changes it.
- Do not silently weaken the scheduling algorithm or thesis evaluation to make implementation easier.

For every proposed change, explain:
1. The problem it solves.
2. Why the current implementation is insufficient.
3. The smallest reasonable solution.
4. The failure modes it handles.
5. How it will be tested.

---

## 8. Product Success Criteria

The MVP should prove that Zenflow reduces the effort needed to manage student work.

Focus on observable behavior:
- A user can connect Google Calendar successfully.
- A task can enter Zenflow without requiring a complicated manual workflow.
- The scheduler produces a valid and explainable schedule.
- The resulting event appears in Google Calendar without duplication.
- A user can request a reschedule through MCP.
- Changes propagate reliably.
- LMS updates are detected for at least one supported integration.
- Notifications are meaningful and not excessively noisy.
- Users continue using the workflow after the initial trial.

Do not equate API endpoints implemented with product success.

The critical user journey should be tested end-to-end with a real or controlled test account before the old application workflow is retired.

---

## 9. Your Immediate Task

**Do not implement the entire plan yet.**

Start by examining the actual repository.

Then produce a concise but technically grounded report containing:

1. **Current architecture:** components, technologies, data flow, and relevant code locations.
2. **Reusable components:** what already works and should remain.
3. **Gaps:** what must be built or changed for the new product direction.
4. **Target architecture:** a proposal aligned with the current codebase, not a generic greenfield architecture.
5. **Phased implementation plan:** ordered tasks with dependencies and concrete acceptance criteria.
6. **Data model changes:** only the minimum necessary schema changes.
7. **Reliability risks:** the most important synchronization, concurrency, authentication, and scheduling failure modes.
8. **Testing strategy:** unit, integration, and end-to-end coverage.
9. **Scope to freeze or retire:** existing mobile/UI features that no longer justify investment.
10. **Open questions:** only decisions that materially affect implementation.

For each major recommendation, cite the relevant repository paths and explain what you found there.

Clearly distinguish:
- Verified facts from the codebase.
- Inferences that need confirmation.
- Proposed changes.

Prefer an implementation plan that can deliver the first working vertical slice quickly.

Wait for approval before making broad architectural changes, destructive changes, or starting a large implementation.

The guiding principle is:

**Keep the core intelligence. Reuse the calendar. Minimize user interaction. Make synchronization reliable. Ship incrementally and validate with real users.**
