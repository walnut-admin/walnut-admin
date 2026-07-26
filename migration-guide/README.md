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

## Migration Steps

| # | Step | Description | Guide |
|---|------|-------------|-------|
| 0 | **Prerequisites** | Verify environment, check versions, confirm clean state | [00-prerequisites.md](./00-prerequisites.md) |
| 1 | **Copy Server** | Copy `walnut-admin-server` into `apps/server/` | [01-copy-server.md](./01-copy-server.md) |
| 2 | **Copy Docs** | Copy `walnut-admin-doc` into `apps/docs/` | [02-copy-docs.md](./02-copy-docs.md) |
| 3 | **Configure Root** | Set up root `package.json`, `pnpm-workspace.yaml`, `turbo.json` | (not yet written) |
| 4 | **Install Dependencies** | Run `pnpm install` at root to install all workspace deps | (not yet written) |
| 5 | **Validate Builds** | Build each app independently to confirm nothing is broken | (not yet written) |
| 6 | **Verify Dev Mode** | Run each app in dev mode to confirm live reload works | (not yet written) |

> **Note:** Detailed documentation for each step lives in its own markdown file linked above.

## Important Notes

- The original repositories at `D:\walnut\walnut-admin-client\`, `D:\walnut\walnut-admin-server\`, and `D:\walnut\walnut-admin-doc\` will **NOT** be deleted. They serve as backups.
- No code is modified during this migration — files are copied, then cleaned of build artifacts and git history.
- After the merge, the monorepo will need configuration adjustments (path aliases, dependency deduplication, unified tooling) in later phases.

## References

- [Turbo Documentation](https://turbo.build/repo/docs)
- [pnpm Workspaces](https://pnpm.io/workspaces)
- [Current CLAUDE.md](../CLAUDE.md) — Project conventions and commands
