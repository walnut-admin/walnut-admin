# ADR 0013: Barrel Export Policy

**Date:** 2026-07-29
**Status:** Implemented

## Context

The project needed a consistent policy on whether to use barrel files (`index.ts` re-exports). Barrel files are convenient for consumers but have well-documented downsides: they break tree-shaking, inflate bundle sizes by 30-70%, slow Vite dev server cold start by 2-4 seconds, and confuse bundlers' dependency analysis.

## Decision

**Package entry points use selective, explicit named re-exports. App-internal code uses direct imports only. `export *` is never used.**

### Rules

| Location | Barrel files? | Rule |
|----------|--------------|------|
| Package entry (`packages/*/src/index.ts`) | ✅ Selective only | Explicit named re-exports defining the package's public API |
| App code (`apps/*/`) | ❌ No barrels | Direct deep imports only |
| `export *` wildcard | ❌ Never | Hides exports, breaks tree-shaking |

### Why selective over `export *`

```ts
// ❌ Never — bundler can't determine what's exported, kills tree-shaking
export * from './utils'

// ✅ Explicit — bundler sees exact exports, tree-shaking works
export { formatDate, parseDate } from './utils'
```

This aligns with the 2025/2026 community consensus across Vercel, Callstack, and the broader TypeScript monorepo ecosystem.

### Why app code doesn't use barrels

The user raised this in the Q3.1 grilling session: "deep import 为什么不可以?" — and the community consensus supports this. App code benefits from direct imports because:
- Smaller bundles (30-70% reduction vs barrel imports)
- Faster HMR and dev server cold start
- Cleaner dependency graphs for Turborepo caching

### Why package entries DO use barrels

Package entries benefit from selective barrels because:
- They define a curated public API surface
- Consumers (including external consumers if the package is published) get a stable import path
- The explicit re-exports make the API surface intentional and documented

## Implementation (2026-07-29)

4 packages received selective barrel exports:

| Package | Barrel file | Exports |
|---------|------------|---------|
| `@walnut/contract` | `src/index.ts` | response codes, response envelope, pagination, menu, role, locale, HTTP headers, token types, API routes |
| `@walnut/utils` | `src/index.ts` | queue, regex, crypto primitives |
| `@walnut/client` | `src/index.ts` | browser utils (crypto, file, storage, window), Vue composables |
| `@walnut/axios` | `src/index.ts` | instance, types, constants, adapters (cache, retry, throttle, cancel, merge) |

No app-level barrel files were created or modified.

## Consequences

1. **Consumer imports can use a single path:** `import { ResponseBase, WalnutAdminConstAppResponseCode } from '@walnut/contract'` instead of separate subpath imports.
2. **Tree-shaking preserved:** Selective named exports let bundlers eliminate unused code.
3. **Public API is explicit:** Looking at `index.ts` tells you exactly what the package exposes.
4. **App code stays direct:** No barrel overhead in `apps/admin` or `apps/server`.
5. **No `export *` in the codebase:** ESLint can enforce this if needed in the future.

## Related

- [ADR 0004](0004-direct-contract-consumption.md) — direct contract consumption, no wrapper layers
- [ADR 0006](0006-runtime-api-separation.md) — packages organized by runtime API dependency
