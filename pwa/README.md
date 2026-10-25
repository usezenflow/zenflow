# Zenflow Web (pwa)

For developers. React 19 + Vite PWA, the setup client: login, onboarding and settings.
Tasks arrive through AI assistants over MCP; the schedule moves to the user's own calendar ([ADR-0039](../docs/adr/0039-thin-layer-calendar-native.md)).
A client of the `@zenflow/shared` contract alongside [`mobile/`](../mobile/README.md). Part of the [Zenflow monorepo](../README.md).

## Run

```bash
# From repo root, once:
pnpm install && pnpm shared:build && pnpm core:build

# Inside pwa/, or `pnpm --filter pwa <script>`:
pnpm dev            # builds @zenflow/core, then Vite at http://localhost:5173
pnpm build          # tsc -b && vite build
pnpm typecheck      # tsc -b --noEmit
pnpm lint           # eslint .
pnpm test:e2e       # Playwright (Chromium)
pnpm test:e2e:ui    # Playwright UI mode
```

| Env var         | Used by                | Notes                                                                   |
| --------------- | ---------------------- | ----------------------------------------------------------------------- |
| `VITE_API_URL`  | app, Playwright        | API base, e.g. `http://localhost:8000/api/v1`                           |
| `VITE_MAPS_URL` | app                    | Map base, e.g. `https://api.usezenflow.com/maps`; default is the API origin + `/maps` |
| `MAILHOG_URL`   | Playwright             | Default `http://localhost:8025`; e2e logs in by reading the OTP from it |
| `E2E_BASE_URL`  | Playwright             | Default `http://localhost:5173`                                         |
| `E2E_NO_SERVER` | Playwright             | Set to skip starting `pnpm dev`                                         |

- e2e specs live in `e2e/` ([`playwright.config.ts`](playwright.config.ts)); none are checked in yet.
- e2e needs the backend stack (Postgres, Redis, MailHog) up: see [backend/README.md](../backend/README.md).

## Push and service worker

- The service worker (`src/sw.ts`, `injectManifest`) registers in production builds only (`main.tsx`).
- Web push: `src/lib/push/` subscribes with the VAPID key from `GET /devices/web-push-key` and registers via `api/devices.ts`.
- iOS delivers web push only to an app installed on the home screen (iOS 16.4+).

## Offline

- The shell, fonts and manifest are precached. Navigations fall back to `index.html`.
- The signed-in user is saved to IndexedDB (`src/lib/offline/`) so settings open offline. Logout wipes the cache.

## Stack

| Concern           | Choice                                                                  |
| ----------------- | ----------------------------------------------------------------------- |
| Framework / build | React 19, Vite 6, `vite-plugin-pwa` (auto-update service worker)        |
| Language          | TypeScript 5.7 strict, `@/*` -> `src/*`                                 |
| Styling           | Tailwind CSS v4 (`@tailwindcss/vite`), OKLch tokens, glassmorphism      |
| UI                | Radix UI + `class-variance-authority`, `lucide-react`, Geist font       |
| State             | Zustand user store + component state                                    |
| Routing / forms   | React Router 7; React Hook Form + Zod                                   |
| Dates             | `date-fns`, `rrule`                                                     |
| HTTP              | axios (credentials) with envelope + DTO types from `@zenflow/shared`    |
| Toasts            | Sonner                                                                  |

## Layout

```
pwa/
├── src/
│   ├── api/            # axios client (base.ts) + typed endpoint fns per resource
│   ├── components/     # auth, brand, onboarding, settings, ui (Radix primitives), hoc/with-auth
│   ├── hooks/          # use-user-store, ...
│   ├── lib/            # utils.ts (cn()), toast.tsx (errorToast), push/ (web push client)
│   ├── pages/          # home, login, onboarding, not-found
│   ├── types/          # re-exports of @zenflow/shared shapes
│   ├── utils/          # tz.ts, time.ts, snap.ts, editing.ts, navigation.ts, ...
│   ├── sw.ts           # service worker: precache, offline shell, web push
│   └── App.tsx / main.tsx / index.css
├── e2e/                # Playwright specs + helpers
├── vite.config.ts      # react + tailwind + pwa plugins, @ alias
└── playwright.config.ts
```

`@zenflow/core` ([`packages/core/src/`](../packages/core/src)) is the logic shared with mobile:

- `blocks.ts`, `overlap.ts`, `task-card.ts` (`deriveState`, `withOverlap`, `TASK_CARD_CLASSES`)
- `tasks.ts` (`sessionSchema`, `getSeriesKind`, `placementQualifier`), `recurrence.ts`
- `session-count.ts`, `session-time.ts`, `session-type.ts`, `location.ts`
- `tz.ts`, `time.ts`, `constants.ts`

Screens: [docs/frontend/screens.md](../docs/frontend/screens.md).

## Conventions

- **API layer** (`src/api/`) is the only place axios is called; endpoint fns return typed `@zenflow/shared` shapes.
- **State**: the Zustand user store (`hooks/use-user-store.ts`), hydrated by the auth gate. Everything else is component state.
- **UI**: build from `components/ui/` primitives before adding dependencies. Compose classes with `cn()` and CVA.
- **Errors**: surface through Sonner toasts (`errorToast` in `lib/toast.tsx`).
- **Naming**: files kebab-case, components PascalCase, props camelCase.
- **Desktop only**: no mobile breakpoints unless asked.
- Repo-wide rules: [AGENTS.md](../AGENTS.md).

### Design system: Warm Sunrise

- Taupe base + Amber accent as OKLch tokens in `src/index.css` (`:root` and `.dark`); brand ramp orange, yellow, lime.
- Glass utilities: `.glass-panel`, `.glass-notice` (backdrop blur).
- Dark mode: full token inversion, visible borders.

## Contributing

- ESLint with 2-space indent ([`.editorconfig`](../.editorconfig)); use the `@/...` alias (`no-relative-import-paths` autofixes).
- [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), e.g. `feat(settings): ...`.
- Setup, branching, testing: [CONTRIBUTING.md](../CONTRIBUTING.md).
