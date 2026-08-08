# ADR 0011: Dependency Governance & Release Pipeline

**Date:** 2026-07-29
**Status:** Implemented

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

## Decision 2: Two Fixed Groups — Packages & Apps

**Chosen:** 7 packages use one `fixed` group for synchronized versioning; 3 apps use a second `fixed` group.

**Rationale:**
- **Packages are tightly coupled** — `@walnut/contract` changes cascade to all consumers, `@walnut/utils` is consumed by both frontend and backend. A type change in `contract` is breaking to all package consumers, so synchronized bumping reflects reality. The fixed group covers 7 packages, including `@walnut/types` and `@walnut/ui` (`@walnut/axios` is gone — renamed `@walnut/http`).
- **Apps share their own release moments** — `apps/admin`, `apps/server`, and `apps/docs` release together; a second `fixed` group keeps app versions aligned with each other while remaining decoupled from package version bumps.
- `private: true` removal signals the code is publicly visible (not secret/internal). Does NOT imply intent to publish to npm.
- Unified `0.0.1` as a clean starting point after the repo merge (previous versions were 0.0.1, 0.0.0, 1.0.0, 1.18.0 — inconsistent artifacts of separate repos).

**Alternatives considered:**
- All packages and apps in a single Fixed Group — rejected; package and app release cycles differ, a single group causes spurious bumps in both directions
- Full Independent for all — rejected; 7 packages are tightly coupled and benefit from synchronized versioning
- Fixed packages + independent apps — rejected; the apps release together and benefit from staying in sync with each other

## Decision 3: changesets + @changesets/changelog-github Pipeline

**Chosen:** changesets for version bumping and `fixed` group synchronization; `@changesets/changelog-github` for CHANGELOG generation.

**Rationale:**
- changesets excels at multi-package version management (`fixed` groups, `changeset version`)
- `@changesets/changelog-github` renders per-package CHANGELOG files from GitHub PRs/commits — no separate changelog tool needed
- Separation of concerns: version management ≠ changelog formatting
- `walnut-auto-changeset` bridges conventional commits → `.changeset/*.md` files, preserving the existing commit workflow
- `walnut-release` orchestrates the full pipeline: generate → confirm → version → changelog → tag → push
- `.changeset/config.json` sets `"changelog": "@changesets/changelog-github"` so `changeset version` renders a per-package CHANGELOG

**Tool responsibilities:**

| Tool | Role |
|------|------|
| `walnut-auto-changeset` | Generate `.changeset/*.md` from conventional commits since last tag (invoked internally by `walnut-release`) |
| `changeset version` | Bump versions in all `package.json` (sync via `fixed` groups), consume changeset files |
| `@changesets/changelog-github` | Render per-package `CHANGELOG.md` (configured via the `changelog` field in `.changeset/config.json`) |
| `walnut-release` | Orchestrate: auto-generate → interactive bump confirm → version → changelog → tag → push |

**Key configuration:**
- `.changeset/config.json`: two `fixed` groups — 7 packages (`utils`, `contract`, `types`, `client`, `http`, `ui`, `eslint-config`) and 3 apps (`admin`, `server`, `docs`); `changelog: "@changesets/changelog-github"`, `access: public`

## Consequences

- `pnpm add` without `--save-catalog` will now fail — developers must use `pnpm add <pkg> --save-catalog`
- `pnpm release` (= `walnut-release`, `main` branch only) executes the full release pipeline
- No root `changeset` / `changeset:auto` / `changelog` scripts — auto-changeset runs internally inside `walnut-release`
- 7 packages and 3 apps are each mechanically kept in sync via their own `fixed` group — no manual version editing needed

## Related

- Supersedes the versioning aspect of ADR 0008 (unified versioning confirmed, deploy separation unchanged)
- Enables ADR 0009 quality gates (changesets provide the version management foundation for CI test requirements)
- References: `docs/architecture/04-toolchain.md`; release orchestration lives in `packages/tooling/release/`
