# PWA screens and behaviour

For developers working on `pwa/`. Setup and conventions live in [pwa/README.md](../../pwa/README.md). Scope: [ADR-0039](../adr/0039-thin-layer-calendar-native.md).

## Routing and auth

| Route         | Page                    | Notes                                                        |
| ------------- | ----------------------- | ------------------------------------------------------------ |
| `/`           | `pages/home.tsx`        | settings; gated by `with-auth.tsx`; `?focus=dlu` scrolls to LMS and portal |
| `/login`      | `pages/login.tsx`       | email, then OTP verification                                 |
| `/onboarding` | `pages/onboarding.tsx`  | shown until `onboardedAt` is set                             |
| `*`           | `pages/not-found.tsx`   | 404                                                          |

- Timezone is captured once at OTP signup (`x-timezone` header, `api/auth.ts`).
- `components/hoc/with-auth.tsx` calls `me()` on mount and redirects to `/login?callback=...` when signed out.

## Settings

`components/settings/settings-page.tsx` renders `account-settings.tsx`, top to bottom:

- Finish setup card: notifications and LMS connection.
- Profile and student card.
- Appearance, preferences (language, default reminder, notifications) and travel.
- LMS and portal: connect, sync, disconnect; last-sync status; credentials never returned.
- Advanced: timezone, storage, and AI assistants (`ai-assistants-section.tsx`): MCP and REST URLs, the system prompt and personal tokens from `/users/me/api-access`. The secret shows once at creation; revoke asks to confirm.
- Sign out.

## Toasts

`components/ui/sonner.tsx`; glass style is `.glass-notice` in `src/index.css`.

- Geist font and a small tinted icon per type.
- iPhone-style collapsed stack: only the newest is fully visible.
- Click the pile to fan it out, click elsewhere to fold it. Hover does nothing (`useClickToExpand` drives sonner's `expand`).
- Every call site passes a short title plus a `description`.
- Use `errorToast(title, { description })` and `apiErrorMessage(error, fallback)` from `lib/toast.tsx`.
