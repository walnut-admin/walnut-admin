# ADR-0009: CI Quality Gates

**Date:** 2026-07-28
**Status:** Accepted
**Last revised:** 2026-09-23 — 门禁表按现状更新：git 钩子改由 lefthook 托管（ADR 0018），pre-push 是五段
聚合命令 `pnpm --silent prepush`；CI 步骤补 boundaries / affected 自检 / syncpack / `pnpm change check`；
`test` 任务的依赖是 `["^build"]`；`@walnut/axios` 已更名 `@walnut/http`。

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
| Pre-push | `git push` | `pnpm --silent prepush` — five sections: `boundaries` → `types:check` → `syncpack:lint` → `lint:workflows` (actionlint) → `pnpm change check` (fixed-group lockstep). Hook definition lives in [`lefthook.yml`](/lefthook.yml), see [ADR 0018](/content/adr/0018-git-hooks-lefthook) | Push |
| CI | Push to main / PR | `pnpm boundaries` → affected `lint` / `types:check` / `test` → affected-set sanity check → `pnpm syncpack:lint` → `pnpm change check` → builds | Merge |

**Test requirements by package:**

| Package | Test requirement |
|---------|-----------------|
| `@walnut/utils` | **Required** — pure functions, easy to test |
| `@walnut/contract` | **Required** — snapshot tests for constants, no-duplicate-code validation |
| `@walnut/client` | **Eventually** — complex browser/Vue code, needs jsdom setup |
| `@walnut/http` | **Eventually** — adapter tests need mock server |
| `@walnut/admin` | **Eventually** — complex SPA, needs component/E2E tests |
| `@walnut/server` | **Existing** — vitest + playwright already configured |

**`turbo.json` test task**: `dependsOn: ["^build"]` — a package's tests need its upstream dependencies' build output
(`@walnut/contract` / `@walnut/utils` publish a CJS `dist/` for the backend's `require` path, see ADR 0002), while the
package under test is *not* built first: Vitest compiles it from source with esbuild. `["^build"]` (not `["build"]`)
is the correct chain per industry standard (see `docs/reference/04-testing-strategy.md`).

## Consequences

- Pre-push stays in the ten-second class (no test execution) even though it now runs five sections
- CI catches test failures without blocking local development flow
- Shared packages (`utils`, `contract`) get test coverage first — highest blast radius
- Version drift inside `versioning.fixed` is caught on the PR that introduces it (`pnpm change check`), not at release time
- `turbo test` runs affected packages only (via `--affected` with an explicit `TURBO_SCM_BASE`/`TURBO_SCM_HEAD` base)
