# ADR-0003: No Environment-Dependent Defaults in Shared Packages

**Date:** 2026-07-28
**Status:** Accepted

## Context

During the `@walnut/shared` → `@walnut/utils` + `@walnut/client` split, we found code in what was supposed to be a "pure utility" package that depended on build-environment globals:

```typescript
// ❌ In @walnut/shared (supposedly a shared utility)
shouldEncrypt: () => boolean = () => !import.meta.env.DEV
```

```typescript
// ❌ In @walnut/shared
const key = `${name}__${import.meta.env.MODE}__${key}`
```

```typescript
// ❌ In @walnut/shared
import { name, version } from '~build/package'  // Vite-only virtual module
```

These dependencies mean:
- The code cannot be consumed by the backend (no `import.meta.env`, no `~build/package`)
- Tests fail outside a Vite context (no `import.meta.env.DEV`)
- The "shared" package leaks build assumptions into consumers

## Decision

**Utility functions in `packages/` MUST accept configuration as explicit parameters.** No reading from `import.meta.env`, `process.env`, or Vite virtual modules.

| Before (❌) | After (✅) |
|------------|-----------|
| `shouldEncrypt` defaults to `!import.meta.env.DEV` | `shouldEncrypt` is a required parameter |
| `getStorageKey` reads `import.meta.env.MODE` | `getStorageKey` accepts an optional `prefix` parameter |
| `version` from `~build/package` | `version` read from own `package.json` |

## Consequences

- `withAsyncConditionalEncryption` and `withSyncConditionalEncryption` now require an explicit `shouldEncrypt` callback from the caller
- `getStorageKey` uses a `DEFAULT_PREFIX` that callers can override
- Callers (admin app) inject environment behavior at the call site, not in the library
- No `import.meta.env` or `process.env` anywhere in `packages/`
