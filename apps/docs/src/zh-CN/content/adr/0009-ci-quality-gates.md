# ADR-0009: CI Quality Gates

**Date:** 2026-07-28
**Status:** Accepted
**Last revised:** 2026-11-24 — 推送前门禁是一张**可增删的表**（`tooling/scripts/src/ci/prepush.ts` 的 `PREPUSH_GATES`），
本 ADR 不再逐段列出（写死的段数已经错过一次）；经 turbo 扇出的几段在同一时刻只跑一段（并发上限数得到
「段」、数不到段里面的扇出）。CI 的每个门禁步骤经统一入口 `pnpm walnut <id>` 调用（ADR 0029）。发版前另有一张
**发版电池**（`tooling/release/src/release/steps.ts`），它是推送前门禁表的超集，由用例核对 —— 此前的修订没有提到它。
CI 的 worker 冒烟改调本地 CI 的同一条实现（`pnpm walnut ci:local --only=worker-smoke`），不再在 workflow 里内联脚本。

> 2026-09-23 的修订（原文保留）：门禁表按现状更新：git 钩子改由 lefthook 托管（ADR 0018），pre-push 是一张门禁表（并行）
> 聚合命令 `pnpm --silent prepush`（含 `lint:root` / `types:check:root` / `lint:docs-refs` / `lint:adr` / `lint:doc-ts` / `lint:doc-budget`）；CI 步骤补 boundaries / affected 自检 /
> syncpack / `pnpm change check` / `lint:root` / `types:check:root` / `lint:adr` / `lint:doc-ts` / `lint:doc-budget`；
> `test` 任务的依赖是 `["^build"]`；`@walnut/axios` 已更名 `@walnut/http`。

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
| Pre-push | `git push` | `pnpm --silent prepush` — 一张门禁表（并行执行、每段各有预算），内容以 `tooling/scripts/src/ci/prepush.ts` 的 `PREPUSH_GATES` 为准，本 ADR 不列清单。Hook definition lives in [`lefthook.yml`](/lefthook.yml), see [ADR 0018](/content/adr/0018-git-hooks-lefthook) | Push |
| CI | Push to main / PR | `pnpm boundaries` → affected `lint` / `types:check` / `test` → affected-set sanity check → `pnpm syncpack:lint` → `pnpm change check` → builds（其中 worker 冒烟经 `pnpm walnut ci:local --only=worker-smoke` 调本地 CI 的实现） | Merge |
| Release | `pnpm release` | 发版电池：推送前门禁表的超集，表在 `tooling/release/src/release/steps.ts`，与门禁表的一致性由用例核对 | Tag / push |

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
is the correct chain per industry standard (see [行业调研：测试体系](../industry-research/04-testing-strategy.md)).

## Alternatives considered

- **Keep the pre-decision setup (`simple-git-hooks` with a pre-push that only ran `pnpm types:check`, and no CI workflow running tests)** —— pre-merge validation has to catch type errors, lint violations, and regressions before they reach production.
- **Run the test suite in the pre-push hook instead of in CI** —— pre-push is deliberately kept in the ten-second class, so it executes no tests; CI is what catches test failures without blocking the local development flow.

## Consequences

- Pre-push stays in the ten-second class (no test execution) even though it now runs five sections
- CI catches test failures without blocking local development flow
- Shared packages (`utils`, `contract`) get test coverage first — highest blast radius
- Version drift inside `versioning.fixed` is caught on the PR that introduces it (`pnpm change check`), not at release time
- `turbo test` runs affected packages only (via `--affected` with an explicit `TURBO_SCM_BASE`/`TURBO_SCM_HEAD` base)
- **2026-11-25 追记**：`apps/server/playwright` 那套手写沙盒 demo 已退役（零消费方、CSV 资产不在仓、
  脚本跑不完整；手写数据不迁移，需要时可从合并提交 `b63ec42a` 取回）。将来 risk / 浏览器侧测试统一走
  `apps/e2e`（`@playwright/test`），`@walnut/server` 不再自带 playwright 依赖。
- **2026-11-25 追记（nightly E2E 工作流）**：新增 `.github/workflows/e2e.yml` —— 触发只有
  `schedule`（每日 UTC 19:00 ≈ 北京 03:00）与 `workflow_dispatch`，**不进 PR**，跑全量
  `pnpm walnut e2e`（job 级 services 起 PostgreSQL / Redis）。artifact 按**严格口径**只传
  junit / json / 脱敏后的后端日志 / `stack.json` / 基线清单；trace、截图、HTML 报告不上传
  （`apps/e2e/AGENTS.md` 不变量 8）。分层不变：PR 只放快而可靠的门禁，全量回归由 nightly 与手动
  dispatch 承担。
  **2026-11-27 追记（形态已演进）**：上面「跑全量 `pnpm walnut e2e`」是当时的单 job 形态；现在
  是 **prepare job 构建一次 + matrix 五 job**（`smoke` / `risk` / `network` / `pages` / `journey`，
  各跑 `--project=<profile>`），artifact 上传另加「脱敏成功才传」的闸门。分层结论不变。
