# ADR 0011: Dependency Governance & Release Pipeline

**Date:** 2026-07-29
**Status:** Implemented
**Last revised:** 2026-09-23 — Decision 2 与 Decision 3 被重写（单一 fixed 组 + pnpm 原生 release management + git-cliff）。
原决策的理由与历史保留在各自的 "Alternatives considered" 里。

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

**Alternatives considered:**
- ESLint `pnpm/json-enforce-catalog` — belt-and-suspenders, but redundant with pnpm's native check
- No enforcement — relying on convention alone; rejected because convention degrades over time

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

**Alternatives considered:**
- **Two fixed groups (Apps + Packages)** — the previous design; rejected per the trap above.
- **All packages in one group + apps independent** — rejected; the tag needs a single source, and
  a package-only release would still produce no tag.
- **Full Independent for all** — rejected; 9 packages are tightly coupled (`@walnut/contract`
  changes cascade to every consumer) and benefit from synchronized versioning.

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
- `lint:root` is **not** a turbo task (it is a root `package.json` script), so the battery runs it as its
  own step — `turbo run lint` + `pnpm lint:root`. Folding it into one `turbo run lint lint:root` fails
  with `Could not find task 'lint:root' in project` (fixed 2026-09-23; see
  [`monorepo/release.md`](/content/monorepo/release)).

**Alternatives considered:**
- **Keep `@changesets/cli` + `@changesets/changelog-github`** — the previous design. Its changelog
  format is richer out of the box (it parses `pr:` / `commit:` / `author:` directives out of the
  changeset body), but it has no ledger, no `change check`, and requires a second config file.
  Rejected because the ledger + gate are worth more here than the plugin.
- **`versioning.changelog.storage: repository`** (pnpm writes the committed changelog) — rejected;
  it writes `CHANGELOG.md` itself with no way to keep only intent consumption, so git-cliff would
  produce a duplicate section for the same version.
- **A hand-rolled changelog writer reading `git log`** — rejected; git-cliff already solves
  grouping, link generation, and per-package path scoping, and its config is testable.
- **`offline = true` + a literal repo URL in the template** — rejected; it forfeits PR numbers and
  authors, which are the whole reason to prefer commit-derived changelogs.

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
