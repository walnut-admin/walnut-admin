# ADR-0011: Dependency Governance & Release Pipeline

**Date:** 2026-07-29
**Status:** Accepted
**Last revised:** 2026-09-23 — Decision 2 与 Decision 3 被重写（单一 fixed 组 + pnpm 原生 release management + git-cliff）。
原决策的理由与历史集中收进下方唯一的 `## Alternatives considered` 小节。

## Context

After the monorepo merge and Phase 1-3 refactors, the project had excellent dependency consistency (248 catalog entries, all `package.json` using `catalog:` or `workspace:*`), but lacked mechanical enforcement, version management tooling, and a unified release strategy.

Three interdependent decisions needed to be made:

1. Whether to enforce catalog-only dependencies mechanically
2. How to handle version identity across apps and packages
3. What release tooling to adopt

## Decision 1: Enable `catalogMode: strict`

**Chosen:** `catalogMode: strict` in `pnpm-workspace.yaml`.

**Rationale:**
- pnpm 10.12+ native enforcement is stronger than ESLint rules (runs at install time)
- Zero breakage — all existing deps already use `catalog:` protocol
- One-line change with no maintenance burden
- Prevents future version drift from `pnpm add` without `--save-catalog`

## Decision 2: One Fixed Group — every workspace package

**Chosen:** a **single** `versioning.fixed` group containing **all** workspace packages
(originally 3 apps + 9 packages; **14** since 2026-09-23, when `packages/tooling/` was split into
5 packages — see [ADR 0019](0019-tsconfig-presets-and-no-mjs.md)). Every package always shares one
version number, so the release tag `vX.Y.Z` always has exactly one source (the group version,
baselined on `apps/admin`).

**Rationale:**
- **Two groups left a structural trap.** pnpm's (and changesets') fixed groups are mutually
  *independent*. A release that only touched a shared package (e.g. `feat(utils): …`) bumped the
  packages group while `apps/admin`'s version stayed put ⇒ the orchestrator hit
  "版本号未变更，跳过发版" and exited 0, leaving a workspace that had **been bumped but would never
  get a tag**. One group removes that path structurally rather than by convention.
- **It matches the ADR-0008 title** (Unified Versioning) — unified versioning was already the
  intent; two tracks were an accident of the original package layout.
- **Nothing was lost.** All packages sat at `0.0.1` with zero tags; the separate package track
  was never exercised.
- `private: true` removal signals the code is publicly visible (not secret/internal). Does NOT
  imply intent to publish to npm.
- Unified `0.0.1` as a clean starting point after the repo merge (previous versions were 0.0.1,
  0.0.0, 1.0.0, 1.18.0 — inconsistent artifacts of separate repos).

**Consequences for attribution:** with one group, "which package does this commit belong to" no
longer affects the version number — it only decides *whether* a commit produces a change intent.
Attribution is path-first, scope-as-fallback, and infrastructure scopes (`docker`, `deploy`,
`pnpm`, `release`) plus unknown scopes produce **no** intent. This is deliberate: infrastructure
changes must not drive the product version.

## Decision 3: pnpm native release management + git-cliff

**Chosen:** version + intent management by **pnpm's built-in release management**
(`pnpm change` writes intents, `pnpm version -r` consumes them, `.changeset/ledger.yaml` is the
consumption ledger), configured by the `versioning:` block in `pnpm-workspace.yaml`.
Per-package `CHANGELOG.md` is rendered by **git-cliff** and written by
`packages/tooling/release/src/release/changelog.ts` (`@walnut/release`) — the **sole writer**.

**Rationale:**
- **The ledger is the thing that was missing.** `pnpm version -r` records every consumed intent in
  a committed, append-only `.changeset/ledger.yaml`. "Has this intent been consumed?" becomes an
  unambiguous fact instead of a heuristic over "is the file still on disk?" — which is exactly what
  the old `handleFailedPushResume()` heuristic got wrong.
- **`pnpm change check` is a real gate.** It fails when a package's committed version drifts out of
  its `versioning.fixed` group, so it runs in CI and in `prepush` — the drift is caught on the PR
  that introduced it, not at release time.
- **Version policy has one source.** `pnpm-workspace.yaml` holds both the workspace layout and the
  version policy; `.changeset/config.json` (a second config file that described the same thing) is
  gone.
- **git-cliff renders from commits, not from intent prose.** The old pipeline's changelog entries
  were the changeset summaries; git-cliff renders grouped, linked entries directly from git history
  with PR numbers and authors (via git-cliff's native GitHub provider).
- `versioning.changelog.storage: registry` keeps pnpm from writing its own changelog files
  (`repository` mode has no "off" switch, so both writers would emit a second `## X.Y.Z` section for
  the same version — the classic footgun when using git-cliff for changelogs).

**Tool responsibilities:**

| Tool | Role |
|------|------|
| `pnpm change` | Write a change intent (`.changeset/*.md`) — invoked per commit by the orchestrator |
| `pnpm version -r` | Bump versions across the fixed group, write `ledger.yaml` |
| `pnpm change check` | Validate committed versions against `versioning.fixed` (CI + prepush gate) |
| git-cliff | Render changelog sections (`--unreleased --tag vX.Y.Z`, per-package include/exclude paths) |
| `walnut-release` | Orchestrate the six steps: intents → bump confirm → consume → changelog → summary → commit/gates/tag/push（bin of `@walnut/release`, in `packages/tooling/release/`） |

**Key configuration:**
- `pnpm-workspace.yaml#versioning`: single `fixed` group (14 packages since 2026-09-23); `changelog.storage: registry`
- `cliff.toml` (repo root): group names, `tag_pattern`, `commit_parsers` kept in step with
  `commit-intent.ts`'s `BUMP_MAP`, and the `[remote.github]` provider
- `pnpm release --status` / `--plan` / `--dry-run` / `--json` are the read-only and machine-readable
  surfaces; the resume ladder is a pure function of observable facts (`release/plan.ts`)
- `lint:root` / `types:check:root` are **not** turbo tasks (they are root `package.json` scripts), so the
  battery runs each as its own step — `turbo run lint` + `pnpm lint:root` + `pnpm types:check:root`.
  Folding them into the turbo argv fails with `Could not find task 'lint:root' in project`
  (fixed 2026-09-23; see [`monorepo/release.md`](/content/monorepo/release)).

## Alternatives considered

### Decision 1: 启用 `catalogMode: strict`

- **ESLint `pnpm/json-enforce-catalog`** —— 双重保险，但与 pnpm 的原生检查重复。
- **不做任何强制、只靠约定** —— 否决；约定会随时间退化。

### Decision 2: 单一 fixed 组（覆盖全部 workspace 包）

- **两个 fixed 组（Apps + Packages）** —— 即原设计；因上述结构性陷阱被否决。
- **全部包一组、apps 各自独立** —— 否决；tag 需要唯一来源，而只发包的版本仍然产生不了 tag。
- **全部 Full Independent** —— 否决；9 个包紧耦合（`@walnut/contract` 的改动会级联到每个消费方），同步版本更有利。

### Decision 3: pnpm 原生 release management + git-cliff

- **保留 `@changesets/cli` + `@changesets/changelog-github`** —— 即原设计；开箱的 changelog 格式更丰富（能从 changeset 正文解析 `pr:` / `commit:` / `author:` 指令），但没有 ledger、没有 `change check`，还要多一个配置文件；此处 ledger + 门禁比该插件更值，故否决。
- **`versioning.changelog.storage: repository`**（由 pnpm 写入提交进仓库的 changelog）—— 否决；它会自己写 `CHANGELOG.md`，无法只保留 intent 消费，git-cliff 会为同一版本产出重复章节。
- **手写读取 `git log` 的 changelog writer** —— 否决；git-cliff 已解决分组、链接生成与按包路径筛选，且其配置可测试。
- **`offline = true` + 在模板里写死仓库 URL** —— 否决；会丢掉 PR 号与作者，而这两者正是选用「从提交渲染 changelog」的全部理由。

## Consequences

- `pnpm add` without `--save-catalog` will now fail — developers must use `pnpm add <pkg> --save-catalog`
- `pnpm release` (= `walnut-release`, `main` branch only) executes the full pipeline; there is no
  root `changeset` / `changeset:auto` / `changelog` script
- All workspace packages are mechanically kept in one version via the single `fixed` group — no manual
  version editing, and `pnpm change check` catches drift
- A workspace package that is not listed in `versioning.fixed` blocks the release (the fixed-group
  audit in `release/attribution.ts` fails the run with exit 1)
- Changelog writing is a **single-writer** property: git-cliff renders, `changelog.ts` writes, and
  pnpm is configured not to write — a duplicate `## X.Y.Z` section would mean that property broke
- The release does **not** create the GitHub Release: `pnpm release` regenerates and commits the
  root `changelog-latest.md`, and `.github/workflows/release.yml` publishes it as the Release body.
  The release machine therefore needs no credential that can modify remote content

## Related

- Supersedes the versioning aspect of ADR 0008 (unified versioning confirmed, deploy separation unchanged)
- Enables ADR 0009 quality gates (the version management foundation for CI test requirements)
- ADR 0018 records the git-hook migration (`simple-git-hooks` → lefthook) that this pipeline assumes
- ADR 0019 records the tooling split (`@walnut/tooling` → `@walnut/scripts` + `@walnut/release`) and the
  `fixed` group growing from 12 to 14 packages
- References: release orchestration lives in `packages/tooling/release/src/release/`
  (module map in that package's `README.md`); operator guide in
  [`monorepo/release.md`](/content/monorepo/release)
