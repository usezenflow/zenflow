# Zenflow Mobile

For developers. Expo + React Native app (iOS, Android, web) that shares `@zenflow/shared`
(contract) and `@zenflow/core` (logic) with the web [`pwa/`](../pwa/README.md).
Part of the [Zenflow monorepo](../README.md). Screens are designed first in [`mockups/`](../mockups/); look and feel rules are in [`docs/mobile/design.md`](../docs/mobile/design.md).

## Run it

Needs Node 20+, pnpm, and an Android emulator or iOS simulator (iOS needs macOS).
The app uses native modules, so it runs as a **dev client**, not Expo Go.

```bash
pnpm install                          # repo root, once
cp mobile/.env.example mobile/.env.local

# Scripts: inside mobile/, or `pnpm --filter mobile <script>`
pnpm android        # expo run:android: build + install the dev client
pnpm ios            # expo run:ios (macOS only)
pnpm dev            # expo start --dev-client --clear: Metro for an installed client
pnpm dev:android    # expo start -c --android (reuses an installed build)
pnpm dev:ios        # expo start -c --ios
pnpm dev:web        # expo start -c --web -> http://localhost:8081
pnpm ios:personal-team  # prebuild + run on a device with a free Apple team
pnpm export         # static web export -> dist/
pnpm typecheck      # tsc --noEmit
pnpm test           # unit + component tests (see docs/mobile/testing.md)
pnpm e2e            # Maestro smoke flows against a booted device
pnpm format         # Biome
```

A new native module needs a fresh dev-client build (`pnpm android` / `pnpm ios`); the offline cache
(MMKV, NetInfo) and glass blur (`expo-blur`) are such modules.
Tests are layered (unit, component with MSW, Maestro e2e); how to run each is in [`docs/mobile/testing.md`](../docs/mobile/testing.md).

## Environment

| Variable                | Used for                                                                      |
| ----------------------- | ----------------------------------------------------------------------------- |
| `EXPO_PUBLIC_API_URL`   | API base URL (`.env.local`; example `http://localhost:8000/api/v1`)           |
| `EXPO_PUBLIC_MAPS_URL`  | Optional. Map base URL; defaults to `<API origin>/maps` |
| `EXPO_IOS_BUNDLE_ID`    | Override iOS bundle id (default `com.zenflow.app`) for personal-team builds   |
| `EXPO_APPLE_TEAM_ID`    | Apple team for local device builds (set by `pnpm ios:personal-team`)          |

- A loopback API host is rewritten to the dev machine's LAN address on device/emulator ([`lib/api-client.ts`](lib/api-client.ts)).
- Offline behaviour and how to simulate it (dev menu *Toggle offline*): [docs/mobile/offline.md](../docs/mobile/offline.md).
- Android push needs `google-services.json` next to `app.config.ts` (absent: push inert).
- iOS push needs the `expo-notifications` plugin, a backend APNs key and a real device.

## Tech stack

| Concern       | Choice                                                                        |
| ------------- | ----------------------------------------------------------------------------- |
| Framework     | Expo SDK 58, Expo Router, React Native 0.88 (New Architecture only), React 19 |
| Styling       | Tailwind v3 via NativeWind v4                                                 |
| UI            | Hand-rolled shadcn/RN-Reusables in `components/ui/` + `components/primitives/` |
| Fonts         | Geist, local via `expo-font`                                                  |
| Language      | TypeScript (strict, `@/*` alias)                                              |
| State / forms | Zustand; React Hook Form + Zod                                                |
| HTTP          | axios (`api/`), cookie session                                                |
| UI libs       | `@gorhom/bottom-sheet` v5, `@react-native-community/datetimepicker` |
| Formatter     | Biome                                                                         |

## Structure

```
mobile/
├── app/            # Expo Router: _layout (Stack.Protected guards), (auth), (onboarding), (app) tabs, task/, notifications
├── api/            # the only HTTP layer: auth, tasks, users, tags, files, devices, integrations, notifications, api-access, insights
├── components/     # ui/, primitives/ (.native/.web), calendar/, tasks/ (+ form/), settings/, onboarding/
├── hooks/          # use-user-store, use-notifications, use-push-registration, use-device-calendar, ...
├── lib/            # api-client, session, i18n*, push, device-calendar/, date math, ...
├── plugins/        # Expo config plugins: withAndroidBuildFixes, withIosBuildFixes
├── scripts/        # iOS personal-team helpers
└── global.css, tailwind.config.ts, metro.config.js, babel.config.js   # NativeWind wiring
```

## Routing

The root layout uses `Stack.Protected` guards (Zustand-driven): signed out mounts only login,
signed in without `onboardedAt` only onboarding, else the app. While the session loads every group
is mounted under the splash so the launch URL `/` resolves, then the guards narrow. Custom tab bar: Calendar, Today, Me.

| Route               | Screen                                                                            |
| ------------------- | --------------------------------------------------------------------------------- |
| `/(auth)/login`     | student ID or email then OTP; timezone captured on verify                         |
| `/(onboarding)`     | first-run setup (focus band, LMS, notifications)                                                      |
| `/(app)` (Calendar) | home: Day, Week or Month view behind one header; Day is the timeline + 7-day chip strip, with the Today card and a collapsed Insights section (focus map, last 7 days, prep buffers) |
| `/(app)/today`      | Today tab: redirects to the calendar's Day view on today                          |
| `/(app)/settings`   | Me tab: profile, appearance, preferences (language, default reminder), integrations; Advanced holds timezone, storage and AI assistants (MCP and REST endpoints, prompt, tokens) |
| `/task/new`         | create task or event (bottom-sheet composer)                                      |
| `/task/[id]/edit`   | edit session (same composer; type fixed), opened from a block's detail sheet      |
| `/notifications`    | ingestion inbox (modal)                                                           |

A calendar block opens its detail sheet in place (`components/calendar/session-detail-sheet.tsx`): peek shows the details, swipe up to full loads the note. Its Edit button pushes `/task/[id]/edit`.

Session model, series-scope editing, recurrence and reschedule match web: see
[ADR-0002](../docs/adr/0002-scheduling-simplification.md).
Task composer is `components/tasks/composer/` (fields in `composer-fields.tsx`); quick-add parsing is `lib/task-parser.ts`; labels and the no-duplicate rule come from `@zenflow/core`.

## Phone calendar

Settings has a "Phone calendar" switch ([ADR-0039](../docs/adr/0039-thin-layer-calendar-native.md)). On, `lib/device-calendar/` writes the schedule into a local "Zenflow" calendar through `expo-calendar`: on launch, on return to the app and after edits. Zenflow is the source of truth; the plan (`plan.ts`) and sync (`sync.ts`) are pure and unit tested, `expo-adapter.ts` is the only code that touches the OS. Event reminders use the account's default reminder. Turn it off if Google Calendar on the phone already shows Zenflow.

## Push and live notifications

Backend: `backend/src/devices/`, `backend/src/notifications/`.

- **SSE:** bell badge and inbox read `GET /notifications/stream` via `react-native-sse` ([`api/notifications.ts`](api/notifications.ts)); no polling. `GET /notifications` is for the initial list and reconnect catch-up.
- **Inbox** ([`app/notifications.tsx`](app/notifications.tsx)): per-topic icon, `NEW`/`CHANGE`/`DROP` badges, relative time, `eventEndsAt`. Swipe left dismisses (`DELETE /notifications/:id`, optimistic).
- **Foreground:** a tap-to-act toast jumps to the affected session (404-guarded).
- **Native push:** the backend speaks FCM/APNs directly, so the app registers the raw device token (not an Expo token) via `POST /devices`. See [`lib/push.ts`](lib/push.ts) and the `use-push-registration` / `use-notifications` hooks. Sign-out unregisters.

## Android home screen widgets

- Add **Zenflow month** (4×2) from the Android widget picker.
- The widget shows a Monday-first calendar and today's sessions.
- Do not disturb sessions stay hidden.
- Tap a session to open its details.
- Tap the calendar to open Month view, or + to open a new task with today's deadline preselected.
- Sign-in, calendar refreshes and session changes refresh widgets. Android also requests an update every 30 minutes.
- A signed-out widget prompts sign-in. An account with no upcoming session shows an empty state.
- The widget needs a fresh Android dev-client build after installation: `pnpm android`.

## Language

- Tiếng Việt is the default; English is selectable on the login screen and in Settings, and applies without resetting navigation or forms.
- Account `User.lang` is authoritative; the cached preference covers pre-login and offline. Login updates the account to the language shown. Failed saves roll back.
- Use `t()` from [`lib/i18n.ts`](lib/i18n.ts) for copy and `useLanguage()` in display components, including memoized ones.
- Use `locale()`, `dateFnsLocale()` and the localized `format()` for display dates. API dates keep their numeric format.
- Dictionaries: [`i18n-vi.ts`](lib/i18n-vi.ts), [`i18n-task.ts`](lib/i18n-task.ts), [`i18n-common.ts`](lib/i18n-common.ts). Shared validation messages translate at the mobile boundary.
- Leave task titles, notes, names, locations and existing tags unchanged; suggested tags follow the language.
- Backend notifications use the account language, so sync the preference before sending.
- Vietnamese on Android uses an in-app date grid; iOS passes the locale to its native picker.

## Contributing

Biome, 2-space indent, Conventional Commits: see [CONTRIBUTING.md](../CONTRIBUTING.md).
