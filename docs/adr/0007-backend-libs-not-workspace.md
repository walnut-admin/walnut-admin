# ADR-0007: Backend Internal Libraries Stay as NestJS CLI Monorepo

**Date:** 2026-07-28
**Status:** Accepted

## Context

`apps/server/` has its own NestJS CLI monorepo with 9 internal libraries:

```
apps/server/libs/
  config/      @walnut-server/config
  const/       @walnut-server/const
  context/     @walnut-server/context
  db/          @walnut-server/db
  decorators/  @walnut-server/decorators
  exceptions/  @walnut-server/exceptions
  pipes/       @walnut-server/pipes
  types/       @walnut-server/types
  utils/       @walnut-server/utils
```

These are resolved via tsconfig `paths`, compiled by SWC, and coupled to NestJS (decorators, dependency injection, CommonJS).

The question: should they be promoted to pnpm workspace packages like `@walnut/client` and `@walnut/contract`?

## Decision

**No.** Backend libs stay as NestJS CLI internal libraries.

**Reasons:**

1. **Module system mismatch**: Backend libs are CommonJS (`module: commonjs`, `moduleResolution: node10`). Frontend workspace packages are ESM (`moduleResolution: bundler`). Promoting them would create a second class of workspace packages that can only be consumed by the backend.

2. **NestJS coupling**: These libs use `@Injectable()`, `emitDecoratorMetadata`, and NestJS-specific patterns. They are not general-purpose.

3. **Compiler coupling**: Backend uses SWC (not tsc). Promoting to workspace packages would require SWC to resolve them as external dependencies, adding configuration complexity without benefit.

4. **The boundary is already correct**: `@walnut/contract` and `@walnut/utils` (pure, framework-agnostic) bridge the gap via pnpm workspace. The NestJS-coupled code stays where it belongs — inside the server.

## Consequences

- `@walnut-server/*` remains a separate namespace from `@walnut/*`
- Adding a new backend lib requires updating `apps/server/tsconfig.json` paths only
- Backend-only constants live in `@walnut-server/const`; shared constants go to `@walnut/contract`
- Backend-only utilities live in `@walnut-server/utils`; shared utilities go to `@walnut/utils`
