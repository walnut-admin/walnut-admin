# ADR-0001: Package Naming — Honest Names

**Date:** 2026-07-28
**Status:** Accepted

## Context

After merging 3 repos into a monorepo, the `packages/` directory had:

| Package | Claimed | Reality |
|---------|---------|---------|
| `@walnut/shared` | "Shared utilities" | 60% Vue + browser, backend can't consume |
| `@walnut/core` | "Core" | 100% Vue composables |
| `@walnut/ui` | "UI components" | Empty stub (deleted) |
| `@walnut/ai` | "AI" | Empty stub (deleted) |

Misleading names cause:
- Backend developers trying to import from `@walnut/shared` and failing
- New team members not knowing where to put code
- Package boundaries blurring over time as "just put it in shared"

## Decision

Packages are named by **what they contain**, not by aspiration.

| Final Name | Contains | Why this name |
|-----------|----------|---------------|
| `@walnut/utils` | Pure functions, zero framework deps | Industry convention (Vue's `@vue/shared`, TanStack's `query-core`) |
| `@walnut/contract` | Shared types & constants | Describes the API contract between frontend/backend |
| `@walnut/client` | Browser utilities + Vue composables | "Client" accurately covers both crypto wrappers and composables |
| `@walnut/axios` | HTTP client framework | Named after the library it wraps |

**Naming anti-patterns avoided:**
- `shared` — too vague, doesn't indicate what's shared or with whom
- `core` — implies everything depends on it; our backend can't even consume it
- `composables` — only accurate for `use*` functions, not for `aesGcmEncrypt` or `downloadByUrl`

## Consequences

- A developer reading `import { aesGcmEncrypt } from '@walnut/client/crypto/symmetric/aes-gcm'` immediately knows this is browser-only code
- Adding a new pure utility goes to `@walnut/utils`; adding a browser utility goes to `@walnut/client`
- No more "just throw it in shared"
