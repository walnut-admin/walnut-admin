# ADR-0009: CI Quality Gates

**Date:** 2026-07-28
**Status:** Accepted

## Context

The monorepo has 3 apps and 4 packages. Pre-merge validation needs to catch type errors, lint violations, and regressions before they reach production.

Current state:
- `simple-git-hooks`: pre-commit runs `lint-staged`, pre-push runs `pnpm types:check`
- `turbo.json` has `test` task but only `@walnut/server` has vitest configured
- `@walnut/utils`, `@walnut/contract`, `@walnut/client` have vitest config but no tests yet
- No CI workflow running tests on push/PR

## Decision

**Three-tier quality gate:**

| Gate | When | What | Blocks |
|------|------|------|--------|
| Pre-commit | `git commit` | `lint-staged` (ESLint auto-fix on staged files) | Commit |
| Pre-push | `git push` | `pnpm types:check` (all packages) | Push |
| CI | Push to main / PR | `pnpm types:check` + `pnpm lint` + `pnpm test` | Merge |

**Test requirements by package:**

| Package | Test requirement |
|---------|-----------------|
| `@walnut/utils` | **Required** — pure functions, easy to test |
| `@walnut/contract` | **Required** — snapshot tests for constants, no-duplicate-code validation |
| `@walnut/client` | **Eventually** — complex browser/Vue code, needs jsdom setup |
| `@walnut/axios` | **Eventually** — adapter tests need mock server |
| `@walnut/admin` | **Eventually** — complex SPA, needs component/E2E tests |
| `@walnut/server` | **Existing** — vitest + playwright already configured |

**`turbo.json` test task**: `dependsOn: ["build"]` ensures the current package is built before its tests run. `build` itself has `dependsOn: ["^build"]`, so upstream dependencies are transitively satisfied. Vitest uses esbuild for test compilation (not the CJS build output), so `["build"]` is the correct dependency chain per industry standard (see `docs/reference/04-testing-strategy.md`).

## Consequences

- Pre-push remains fast (types only, no test execution)
- CI catches test failures without blocking local development flow
- Shared packages (`utils`, `contract`) get test coverage first — highest blast radius
- `turbo test` runs affected packages only (via `--filter=[HEAD^1]` or similar)
