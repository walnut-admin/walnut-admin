# Walnut Admin Monorepo Migration Guide

## Overview

**Walnut Admin** is a full-stack admin template consisting of a **Vue 3 SPA** (frontend), a **NestJS API** (backend), and **Vitepress** (documentation). These three components currently live in separate repositories:

| Component | Current Repo | Target Location |
|-----------|-------------|-----------------|
| Vue 3 SPA | `walnut-admin-client` | `apps/admin/` |
| NestJS API | `walnut-admin-server` | `apps/server/` |
| Vitepress Docs | `walnut-admin-doc` | `apps/docs/` |

This guide documents the step-by-step process of merging all three repositories into a single pnpm monorepo at `D:\walnut\walnut-admin\`.

## Target Versions

| Tool | Version |
|------|---------|
| Node.js | >= 24.13.0 |
| pnpm | 11.13.0 |
| TypeScript | 6.0.3 |
| Turbo | 2.4.0 |

## Target Folder Structure

```
D:\walnut\walnut-admin\
├── apps\
│   ├── admin\         @walnut/admin     — Vue 3 SPA (from walnut-admin-client)
│   ├── server\        @walnut/server    — NestJS API (from walnut-admin-server)
│   └── docs\          @walnut/docs      — Vitepress docs (from walnut-admin-doc)
├── packages\          (shared libraries — 5 existing frontend packages)
├── build\             (build scripts & Vite config)
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.json
└── ...
```

## Design Principles

- **Apps are deployable units.** Each directory under `apps/` produces an independently deployable artifact.
- **Packages are reusable, non-business libraries.** The 5 existing shared frontend packages (`@wallet-admin/*`) live under `packages/`. In Phase 2, the server's internal shared code will also be extracted into packages.
- **Server keeps its own internal monorepo.** The NestJS server already uses an internal monorepo structure under `apps/server/apps/api/`. This is preserved as-is — the server's own workspace is nested inside the root workspace.
- **No code changes during migration.** This is purely a structural merge. All code changes (path aliases, config unification, dependency deduplication) happen in subsequent phases.

## Migration Progress

### ✅ Phase 1 — Structural Merge (COMPLETE)

| Step | Status | Notes |
|------|--------|-------|
| 0. Prerequisites | ✅ | Node 24.14, pnpm 11.13 |
| 1a. Copy server → apps/server/ | ✅ | Internal NestJS monorepo preserved |
| 1b. Copy docs → apps/docs/ | ✅ | Fixed: `src/` directory was missed in initial copy |
| 2. Root config | ✅ | Node 24 + pnpm 11 + scripts + .gitignore |
| 3. Server adaptation | ✅ | @walnut/server, cross-env, types:check |
| 4. Docs adaptation | ✅ | @walnut/docs, engines |
| 5. Turbo config | ✅ | Added .vitepress/dist/** outputs |
| 6. pnpm install | ✅ | 3016 packages, 9 workspace projects, allowBuilds approved |
| Fix: .vscode merge | ✅ | Merged client settings.json/extensions.json to root |
| Fix: Admin predev | ✅ | Root .vscode/ required for settings-dev.schema.json generation |

### ⏳ Verification

| App | Dev | Build | Notes |
|-----|-----|-------|-------|
| @walnut/admin | ✅ | ⏳ | |
| @walnut/server | ✅ | ⏳ | Requires MongoDB + Redis |
| @walnut/docs | ✅ | ⏳ | |

### 🔴 Phase 2 — Packages Redesign (PENDING)

See [08-phase2-packages.md](./08-phase2-packages.md) for the full plan.

## Important Notes

- The original repositories at `D:\walnut\walnut-admin-client\`, `D:\walnut\walnut-admin-server\`, and `D:\walnut\walnut-admin-doc\` will **NOT** be deleted. They serve as backups.
- No code is modified during this migration — files are copied, then cleaned of build artifacts and git history.
- After the merge, the monorepo will need configuration adjustments (path aliases, dependency deduplication, unified tooling) in later phases.

## References

- [Turbo Documentation](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Current CLAUDE.md](../CLAUDE.md) — Project conventions and commands
