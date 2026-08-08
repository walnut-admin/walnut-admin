# ADR-0015: Testing Strategy

**Date:** 2026-07-29
**Status:** Accepted

## Context

The monorepo has vitest configured in most packages but zero actual test files in shared packages (`@walnut/utils`, `@walnut/contract`, `@walnut/client`, `@walnut/http`). ADR-0009 established that `@walnut/utils` and `@walnut/contract` **require** tests. This ADR specifies the how: framework, conventions, coverage targets, and file organization.

## Decision 1: Vitest as the Single Test Framework

**Chosen:** Vitest for all packages and apps.

**Rationale:**
- **Industry standard** — Vitest is the de facto test framework for TypeScript monorepos in 2025-2026 (used by tRPC, Nuxt, Vite, Slidev)
- **Shared with Vite** — same config format, same esbuild transform, familiar to frontend developers
- **NestJS compatibility** — works with SWC-compiled NestJS code via minimal configuration
- **Already present** — vitest config exists in `@walnut/utils`, `@walnut/contract`, `@walnut/client`, and `@walnut/server`
- **No Jest migration needed** — the project never adopted Jest; Jest-era remnant dependencies (`jest`, `ts-jest`, `ts-loader`, `ts-node`, `tsconfig-paths`, `@types/jest`) were removed from `apps/server`

**Config per environment:**
- `packages/utils`, `packages/contract`: `environment: "node"`
- `packages/client`: `environment: "jsdom"` + Vue plugin
- `apps/admin`: not yet configured — no `vitest.config.ts` in `apps/admin`
- `apps/server`: `environment: "node"` + SWC plugin (for decorator metadata) — config at `apps/api/vitest.config.ts` (swc + vite-tsconfig-paths); the `test` script runs `vitest run --config ./apps/api/vitest.config.ts` (fixed 2026-08-08 — the script previously could not locate the config)

## Decision 2: Co-located Test Files

**Chosen:** Test files live in `__tests__/` directories co-located with source.

```
packages/utils/src/
├── queue/
│   ├── queue.ts
│   └── __tests__/
│       └── queue.test.ts
├── regex/
│   ├── regex.ts
│   └── __tests__/
│       └── regex.test.ts
```

**Rationale:**
- **Industry convention** — co-location is the dominant pattern in pnpm/Turborepo monorepos
- **Deletion integrity** — deleting a source module also deletes its tests (no orphaned test files)
- **Easy discovery** — developers find tests next to the code they test

**Naming convention:** `*.test.ts` (not `*.spec.ts`). Single consistent extension across the monorepo.

## Decision 3: Layered Coverage Targets

**Chosen:** Different coverage targets by package type, not a single number.

| Package type | Coverage target | Rationale |
|-------------|----------------|-----------|
| Pure utils / contract (`@walnut/utils`, `@walnut/contract`) | **90%+** | Pure functions, logic-dense, easy to test, high blast radius |
| Browser/Vue composables (`@walnut/client`) | **80%+** | Some DOM-dependent logic is harder to test; hooks are testable in isolation |
| HTTP client (`@walnut/http`) | **80%+** | Adapters need mock servers; core logic is pure |
| Vue app (`apps/admin`) | **60%+** | Component tests are expensive; prioritize stores, API layer, and interaction-heavy components |
| NestJS app (`apps/server`) | **60%+** | Services and utils at 80%+; controllers via integration tests; module declarations are boilerplate |

**Principle:** Coverage is a **signal, not a goal**. 100% coverage is not the target — meaningful tests over metric-chasing.

## Decision 4: Test Execution in CI

**Chosen:** `turbo test --filter='[origin/main]'` for affected-only execution.

See ADR-0009 for the three-tier quality gate (pre-commit → pre-push → CI). This ADR specifies the CI layer:
- `turbo.json` `test.dependsOn: []` — no build prerequisite; tests run against source directly
- Affected-only via `turbo --filter` avoids re-running tests on unchanged packages
- Coverage reports uploaded as CI artifacts (Codecov integration deferred — free, add later)

## Consequences

- `@walnut/utils` and `@walnut/contract` are the immediate priority for test writing (per ADR-0009)
- `@walnut/utils`, `@walnut/contract`, and `@walnut/client` have `vitest.config.ts` in place but still zero test files; `@walnut/http` still needs its `vitest.config.ts` and `test` script (currently missing both)
- All packages should standardize on `test`, `test:watch`, `test:coverage` scripts
- No per-package vitest preset sharing needed at this scale — copy patterns from `@walnut/utils`

## Related

- `docs/adr/0009-ci-quality-gates.md` — three-tier quality gate framework
- `docs/reference/04-testing-strategy.md` — industry standard testing practices for monorepos
- `turbo.json` — `test` task configuration
