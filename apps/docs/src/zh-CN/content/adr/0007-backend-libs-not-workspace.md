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

## Alternatives considered

- **Promote the backend libs to pnpm workspace packages** (like `@walnut/client` and `@walnut/contract`) —— the CommonJS backend libs would form a second class of workspace packages consumable only by the backend, they are tightly coupled to NestJS (`@Injectable()`, `emitDecoratorMetadata`), and SWC would have to resolve them as external dependencies, adding configuration complexity without benefit; the boundary is already bridged by the pure, framework-agnostic `@walnut/contract` and `@walnut/utils`.

## Consequences

- `@walnut-server/*` remains a separate namespace from `@walnut/*`
- Adding a new backend lib requires updating `apps/server/tsconfig.json` paths only
- Backend-only constants live in `@walnut-server/const`; shared constants go to `@walnut/contract`
- Backend-only utilities live in `@walnut-server/utils`; shared utilities go to `@walnut/utils`

## 2026-10-31 追记

「libs 解耦批 0-10」已完成：内部 lib 从 9 个基建扩散到 **34 个**（新增 identity / system / auth /
security / app-domain 等域），`apps/api/src` 只剩组合根、wire DTO 与 controller。本 ADR 的结论
（不提升为 workspace 包）不变，并且现在由 ESLint `libs-boundary` 与三个 drift spec 机械守；
分层、组合根与端口注入反转的形态由 [ADR 0022](./0022-backend-lib-layering-and-composition-roots.md)
记录。上文「Adding a new backend lib requires updating `apps/server/tsconfig.json` paths only」
是按当时的语义写的：现在新增 lib 还要同步三份 `infra/nest/*.json` 与三份 `infra/swc/*.swcrc`，
漏项由 `lib-registration.drift.spec.ts` 拦下。
