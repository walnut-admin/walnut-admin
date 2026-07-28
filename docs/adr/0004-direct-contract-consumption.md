# ADR-0004: Direct Contract Consumption — No Wrapper Layers

**Date:** 2026-07-28
**Status:** Accepted

## Context

During the 3-repo merge, AI-generated migration code created wrapper layers around `@walnut/contract`:

```typescript
// apps/admin/src/const/menu.ts — wrapper layer
import { MenuType } from '@walnut/contract/menu'
export const AppConstMenuType = MenuType  // just renames

// apps/admin/src/const/app.ts — wrapper layer
import { Role } from '@walnut/contract/role'
export const AppConstRoles = Role  // just copies
```

```typescript
// packages/axios/src/constant.ts — deprecated alias layer
export const BusinessCodeConst = {
  SUCCESS: WalnutAdminConstAppResponseCode.SUCCESS,
  // ... 11 more aliases
}
```

These layers cause:
- Every new contract constant needs updating in 2+ places
- Git blame shows wrapper maintenance, not real changes
- New developers don't know whether to import from `@/const/menu` or `@walnut/contract/menu`

## Decision

**Consumers import directly from `@walnut/contract`.** Wrapper files are reduced to passthrough re-exports (for backward compatibility), and deprecated aliases are removed.

```typescript
// ✅ Direct import
import { MenuType } from '@walnut/contract/menu'

// ✅ Passthrough (backward compat)
export { MenuType as AppConstMenuType } from '@walnut/contract/menu'

// ❌ Removed
export const BusinessCodeConst = { SUCCESS: WalnutAdminConstAppResponseCode.SUCCESS }
```

## Consequences

- `packages/axios/src/constant.ts` reduced from 42 lines to 2 lines
- `BusinessCodeConst` removed — interceptor now uses `WalnutAdminConstAppResponseCode` directly
- `apps/admin/src/const/menu.ts` and `app.ts` are now passthrough re-exports
- Adding a new response code: change `@walnut/contract` only, consumers pick it up automatically
