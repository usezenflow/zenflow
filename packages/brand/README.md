# @zenflow/brand

Assets both clients use, so they look and sound the same.

| Folder     | Files                                                 | Used by                                  |
| ---------- | ----------------------------------------------------- | ---------------------------------------- |
| `fonts/`   | Geist Regular, Medium, SemiBold, Bold, ExtraBold (TTF) | `mobile/app/_layout.tsx`, `pwa/src/lib/fonts.ts` |
| `sounds/`  | `zenflow_default`, `zenflow_reminder`, `zenflow_urgent` (WAV) | `mobile/app.config.ts`, `pwa/src/lib/sounds.ts` |

- Geist Mono is not part of the brand. Numbers use Geist with `tabular-nums`.
- Chime choice per event: `pushToneFor` in `@zenflow/shared`.
- Android binds a channel's sound for good, so changing a chime needs a new channel id ([design](../../docs/mobile/design.md#sound)).
