# ADR 0011: Dependency Governance & Release Pipeline

**Date:** 2026-07-29
**Status:** Implemented

## Context

After the monorepo merge and Phase 1-3 refactors, the project had excellent dependency consistency (265 catalog entries, all `package.json` using `catalog:` or `workspace:*`), but lacked mechanical enforcement, version management tooling, and a unified release strategy.

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

## Decision 2: Unified Versioning with Independent Identity

**Chosen:** All workspace members share version `0.0.1`, `private: true` removed from all packages.

**Rationale:**
- `private: true` removal signals the code is publicly visible (not secret/internal)
- Does NOT imply intent to publish to npm — just declares the code as open
- Unified `0.0.1` as a clean starting point after the repo merge (previous versions were 0.0.1, 0.0.0, 1.0.0, 1.18.0 — inconsistent artifacts of separate repos)
- `fixed` group in changesets ensures all 8 workspace packages stay in sync going forward

**Alternatives considered:**
- Independent versions per package — rejected; no packages are independently published, adds complexity without benefit
- Keep apps at 1.18.0 and packages at 0.0.1 — rejected; split versioning is confusing when all packages move together

## Decision 3: changesets + git-cliff Pipeline

**Chosen:** changesets for version bumping and `fixed` group synchronization; git-cliff for CHANGELOG generation from conventional commits.

**Rationale:**
- changesets excels at multi-package version management (`fixed` groups, `changeset version`)
- git-cliff excels at changelog rendering from git history (already in catalog at version 2.13.1)
- Separation of concerns: version management ≠ changelog formatting
- `auto-changeset.ts` bridges conventional commits → `.changeset/*.md` files, preserving the existing commit workflow
- `release.ts` orchestrates the full pipeline: generate → confirm → version → changelog → tag → push
- `.changeset/config.json` sets `"changelog": false` to disable changesets' built-in changelog

**Tool responsibilities:**

| Tool | Role |
|------|------|
| `auto-changeset.ts` | Generate `.changeset/*.md` from conventional commits since last tag |
| `changeset version` | Bump versions in all `package.json` (sync via `fixed` group), consume changeset files |
| `git-cliff` | Render `CHANGELOG.md` from git history with conventional commit grouping |
| `release.ts` | Orchestrate: auto-generate → interactive bump confirm → version → changelog → tag → push |

**Key configuration:**
- `cliff.toml`: conventional commit parsing with emoji-categorized groups, GitHub commit links
- `.changeset/config.json`: `fixed` group covering all 8 workspace packages, `changelog: false`, `access: public`

## Consequences

- `pnpm add` without `--save-catalog` will now fail — developers must use `pnpm add <pkg> --save-catalog`
- `pnpm release` (on `main` branch only) executes the full release pipeline
- `pnpm changeset:auto` generates changeset files from commits (for review before release)
- `pnpm changelog` generates CHANGELOG.md via git-cliff
- All versions are mechanically kept in sync via the `fixed` group — no manual version editing needed

## Related

- Supersedes the versioning aspect of ADR 0008 (unified versioning confirmed, deploy separation unchanged)
- Enables ADR 0009 quality gates (changesets provide the version management foundation for CI test requirements)
- References: `docs/architecture/04-toolchain.md`, `scripts/version/release-workflow.md`
