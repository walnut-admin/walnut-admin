# CLAUDE.md

This file provides guidance to Claude Code when working with code in this repository.

## Project Overview

Walnut Admin is a **full-stack monorepo** managed with **Turborepo + pnpm workspaces**.

| App | Package | Tech Stack | Description |
|-----|---------|------------|-------------|
| `apps/admin/` | `@walnut/admin` | Vue3 + Vite + NaiveUI + UnoCSS | Admin SPA frontend |
| `apps/server/` | `@walnut/server` | NestJS + MongoDB + SWC | Backend API |
| `apps/docs/` | `@walnut/docs` | Vitepress | Documentation site |

- Demo: https://www.walnut-admin.com
- Docs: https://walnut-admin-doc.netlify.app

**Key versions:** Node >= 24.13.0, pnpm >= 12.0.0, TypeScript 6.0.3, Turbo 2.9.14

## Development Commands

```bash
pnpm install        # Install all workspace dependencies

# Per-app dev servers
pnpm dev            # = pnpm dev:admin (frontend only, the common case)
pnpm dev:all        # Start ALL three apps simultaneously (server needs MongoDB+Redis)
pnpm dev:admin      # Frontend → http://127.0.0.1:3100
pnpm dev:server     # Backend  → requires MongoDB + Redis
pnpm dev:docs       # Docs     → http://localhost:8886

# Build
pnpm build          # Build everything (packages → apps)
pnpm build:admin    # Frontend only
pnpm build:server   # Backend only
pnpm build:docs     # Docs only

# Code quality
pnpm lint           # Lint all packages
pnpm lint:fix       # Lint with auto-fix
pnpm types:check    # Type check all packages
pnpm test           # Run tests (server + contract snapshots + utils + client + tooling)
pnpm boundaries     # Turbo architecture-boundaries check
pnpm lint:workflows # actionlint over .github/workflows
pnpm prepush        # The pre-push aggregate gate: boundaries + types:check + syncpack + lint:workflows + pnpm change check
pnpm hooks:check    # Assert the git hooks are lefthook-managed

# Release
pnpm release        # Version intents → pnpm version -r → git-cliff changelogs → commit/tag/push
```

## Monorepo Architecture

```
walnut-admin/
├── apps/                    ← Deployable applications
│   ├── admin/               — Vue3 SPA (full frontend app)
│   ├── server/              — NestJS API (own internal monorepo)
│   │   ├── apps/api/        — NestJS application entry
│   │   ├── libs/            — 9 NestJS internal libraries
│   │   │   ├── config/      @walnut-server/config      — env config + validation
│   │   │   ├── const/       @walnut-server/const       — constants + error codes
│   │   │   ├── context/     @walnut-server/context     — ALS context
│   │   │   ├── db/          @walnut-server/db          — Mongoose + transactions
│   │   │   ├── decorators/  @walnut-server/decorators  — custom decorator system
│   │   │   ├── exceptions/  @walnut-server/exceptions  — exceptions + global filter
│   │   │   ├── pipes/       @walnut-server/pipes       — param pipes
│   │   │   ├── types/       @walnut-server/types       — type declarations
│   │   │   └── utils/       @walnut-server/utils       — utilities
│   │   ├── infra/nest/      — nest-cli build configs (dev/stage/prod)
│   │   ├── infra/swc/       — SWC compiler configs
│   │   ├── env-encrypted/    — encrypted env (committed, dotenvx, 注释即模板)
│   │   └── env-local/       — local env (real values, gitignored, generated)
│   └── docs/                — Vitepress documentation site
├── packages/                ← Shared libraries (grouped by platform, ADR 0017)
│   ├── platform-any/        — runtime-agnostic packages
│   │   ├── contract/  @walnut/contract    — types + constants (response codes, enums,
│   │   │                                    pagination, API contracts). CJS build.
│   │   ├── types/     @walnut/types       — ambient type declarations
│   │   └── utils-core/@walnut/utils       — pure utilities (regex, queue, crypto/const,
│   │                                        crypto/transformer). CJS build.
│   ├── platform-web/       — browser/Vue packages (source-only)
│   │   ├── client/   @walnut/client       — browser utilities + Vue composables + store factory
│   │   ├── http/     @walnut/http         — HTTP client framework (instance + adapters)
│   │   └── ui/       @walnut/ui           — naive-ui based components (POC: 3 components)
│   └── tooling/            — toolchain packages
│       ├── eslint-config/    @walnut/eslint-config    — shared ESLint presets (vue/nest/base)
│       ├── commitlint-config/@walnut/commitlint-config — commitlint rules
│       └── scripts/          @walnut/tooling          — repo-level scripts: release
│                                 orchestration, repo gates, env encrypt/decrypt (bins)
├── apps/admin/build/         ← Admin Vite build config (plugins/config/proxy)
├── migration-guide/          ← Migration documentation & tracking
├── turbo.json                ← Turborepo pipeline
├── pnpm-workspace.yaml       ← pnpm workspace + config
├── tsconfig.base.json        ← Shared TS config (frontend ESM)
├── eslint.config.mjs         ← Root ESLint config
└── package.json              ← Root workspace config
```

### Important: Server Internal Monorepo

The server (`apps/server/`) has its own **NestJS CLI monorepo** structure — its `apps/api/` and `libs/` are NOT pnpm workspace packages. They are resolved via TypeScript path aliases in `apps/server/tsconfig.json` and compiled together by NestJS CLI + SWC.

Key differences:
- **Server libs** (`@walnut-server/config`, `@walnut-server/db`, etc.): CommonJS, tsconfig paths, SWC-compiled, NestJS-coupled. The `@walnut-server/*` scope is reserved for these internal libs.
- **Frontend packages** (`@walnut/contract`, `@walnut/utils`, `@walnut/http`, etc.): ESM, pnpm workspace, Vite-compiled, framework-level. The `@walnut/*` scope (without `-server`) is reserved for these.

**Namespace strategy (post Phase 1):** the two scopes (`@walnut/*` vs `@walnut-server/*`) are physically separated to prevent silent misresolution. Adding a new frontend package like `@walnut/utils` will NOT collide with the backend's `@walnut-server/utils`. This was resolved in commit `609722b` — previously both groups shared the `@walnut/` scope and relied on name non-overlap.

## Current State

This monorepo was created by merging three previously separate repositories:
- `walnut-admin-client` → `apps/admin/` + root workspace config
- `walnut-admin-server` → `apps/server/`
- `walnut-admin-doc` → `apps/docs/`

**Architecture cleanup completed (2026-07-26):**
- ✅ Backend lib aliases renamed `@walnut/*` → `@walnut-server/*` (eliminates namespace collision with frontend packages)
- ✅ Empty stub packages `@walnut/ui` and `@walnut/ai` removed (zero consumers, never populated)
- ✅ Orphan `tsconfig.base.node.json` removed (zero consumers)
- ✅ Vestigial `paths` block removed from `tsconfig.base.json` (resolution was broken by baseUrl override; real resolution via pnpm symlinks + package `exports`)
- ✅ `turbo.json` gained a `test` task and `pnpm-workspace.yaml` in `globalDependencies`
- ✅ Root `dev` defaults to `dev:admin` (avoids starting server which needs MongoDB+Redis)
- ✅ Dependencies unified via pnpm `catalog:` (242 entries, single source of truth — ESLint version drift resolved)

**Toolchain hardening (2026-08-08):**
- ✅ `turbo.json` `dev`/`test` tasks now `dependsOn: ["^build"]` — fresh clones can `dev:server` directly (contract/utils CJS dist is a build artifact, see ADR 0002)
- ✅ `turbo boundaries` wired into pre-push hook and CI (`.github/workflows/ci.yml`, P0-1 backlog item)
- ✅ CI quality gates: boundaries → affected lint/types:check/test → affected self-check → syncpack → `pnpm change check` → builds
- ✅ Root `clean:all` covers nested `packages/*/*/node_modules`
- ✅ `@walnut/eslint-config` gained its own lint scripts; `apps/*` marked `private: true`
- ✅ `@walnut/client` `vue`/`pinia` moved to peerDependencies; server tsconfig `strict: true` (tsc zero errors); DOM lib pushed down from `tsconfig.base.json` to admin/docs/platform-web packages; 6 leftover empty `import { } from '@walnut/contract'` removed; `build:stage` is now a dedicated turbo task (triple-dash passthrough retired)

**Release & git-hook migration (2026-09-23):**
- ✅ `@changesets/cli` + `@changesets/changelog-github` removed — version management is now **pnpm 12 native release management**: the `versioning` block in `pnpm-workspace.yaml` is the single source of truth (one `fixed` group covering all 12 workspace packages, `changelog.storage: registry`), `pnpm change` writes intents, `pnpm version -r` consumes them, `.changeset/ledger.yaml` is the consumption ledger, and `.changeset/config.json` is deleted
- ✅ Changelogs are rendered per package by **git-cliff** (root `cliff.toml`) and written by `packages/tooling/scripts/src/release/changelog.ts` (sole writer); root `changelog-latest.md` is regenerated by `pnpm release` and committed (`release.yml` still publishes it via `body_path:`)
- ✅ Git hooks moved from `simple-git-hooks` to **lefthook** (root `lefthook.yml`, ADR 0018): root `postinstall` is gone, `allowBuilds` now has `lefthook: true` instead of `simple-git-hooks: false`, and `pnpm hooks:check` mechanically asserts the hooks are installed
- ✅ `@walnut/release` → **`@walnut/tooling`** (`packages/tooling/release/` → `packages/tooling/scripts/`); the root `scripts/` directory is gone and the old `tsx scripts/*.ts` root scripts became bins (`walnut-release`, `walnut-lint-workflows`, `walnut-setup-env`, `walnut-check-git-hooks`); new root scripts `hooks:check` and `prepush` (five sections incl. `pnpm change check`), which `ci.yml` also runs after syncpack
- ✅ Attribution semantics: with one fixed group, package attribution no longer affects the version number — it only decides *whether* a commit produces an intent (path-first, scope-fallback; infra scopes produce none)
- ✅ Deleted two stale changelog artifacts (root `changelog-latest.md`, `apps/server/changelog-latest.md`)

**CI/CD rebuild (2026-09-21):**
- ⚠️ CI had **never actually run** since 2026-08-13: `steps.if` used the `secrets` context, which the runner rejects → `Invalid workflow file`, startup failure with 0 jobs (looked like an ordinary red build). Fixed by binding the secret to a job-level `env` and testing `env.X != ''`; guarded by `.github/workflows/workflow-lint.yml` (actionlint, a separate file so it can report even if ci.yml breaks) plus `pnpm lint:workflows` in pre-push
- ✅ `turbo --affected` now gets an explicit base/head (`TURBO_SCM_BASE`/`TURBO_SCM_HEAD`) — on direct pushes to main the merge-base is HEAD, so the affected set silently computed empty; a sanity check now fails when files changed but no package is affected
- ✅ Container builds moved off the per-deploy path: `ci.yml` never touches Docker, tag pushes (`release.yml`) build once, `deploy.yml` is a reusable deploy-only workflow (rollback = dispatch with an older tag, 1–3 min)
- ✅ Image builds: `docker-bake.hcl` gives each image its own GHA cache scope (all three previously shared the default `buildkit` scope and overwrote each other → backend was always cold: 15m49s ~ 77m53s, 85 min per deploy), and the heavy work (install/build/`pnpm deploy`) runs on the runner — images only `COPY`
- ✅ Fixed a secret leak: `pnpm deploy --prod` copies `apps/server/env-local` (decrypted env) into the image; both the staging step and the backend Dockerfile now strip it
- ⚠️ `pnpm deploy --prod` marks the workspace `node_modules/.modules.yaml` as `devDependencies: false`, so **any later pnpm command prunes devDependencies** (vite/cross-env disappear) — deploy must be the last pnpm step in a job

**For full architecture details and the remaining refactor roadmap:**
- [`apps/docs/src/zh-CN/content/monorepo/`](./apps/docs/src/zh-CN/content/monorepo/) — 架构文档（TypeScript / ESLint / pnpm Catalog / Turbo / Release / Knip 等 10 篇）
- [`apps/docs/src/zh-CN/content/adr/`](./apps/docs/src/zh-CN/content/adr/) — 架构决策记录（ADR 0001-0018）
- [`apps/docs/src/zh-CN/content/industry-research/`](./apps/docs/src/zh-CN/content/industry-research/) — 行业调研语料
- [`apps/docs/src/zh-CN/content/archive/`](./apps/docs/src/zh-CN/content/archive/) — 归档：带日期的设计 / 计划 / 评审文档（根 `docs/` 目录已移除，全部内容在此）
- `migration-guide/` — historical migration record (Phase 1 merge steps, now completed)

## Frontend Architecture (apps/admin/)

- **Vue 3** Composition API + `<script setup>`
- **Naive UI** component library with auto-registration
- **UnoCSS** utility CSS (Wind preset, Tailwind v3 compatible)
- **Pinia** stores, **Vue Router** (web history), **Vue I18n**
- **Auto-imports**: `unplugin-auto-import` + `unplugin-vue-components`
- **Path alias**: `@/*` → `apps/admin/src/*`, `~/*` → `apps/admin/types/*`
- **Security**: OPAQUE password, WebAuthn/FIDO2, MFA/OTP, RSA encryption, device fingerprinting
- **Build**: Vite 8 with optional obfuscation, CDN, Sentry, CSP (PWA removed 2026-08-08)
- Default port: 3100, proxied `/api` → `http://127.0.0.1:3000/w/v1`

## Backend Architecture (apps/server/)

- **NestJS 11** with Express adapter
- **MongoDB** via Mongoose 9 (replica set required for transactions)
- **Redis** for caching, Bull queues, distributed locks
- **SWC** compiler (not tsc) — configs in `infra/swc/`
- **CommonJS** module system (`"module": "commonjs"`)
- 18 guards (IP, Security, Device, Risk, CAP, JWT, MFA, Sign, Lock...), 16 middleware, custom interceptor/pipe/decorator system
- Comprehensive auth: JWT + OAuth + OPAQUE + WebAuthn + MFA/TOTP
- Custom `@WalnutDBTransaction()` decorator for MongoDB transactions
- Environment: `env-encrypted/` (committed, AES-256 encrypted via dotenvx, 文件内注释即模板) → `env-local/` (plaintext, generated by `pnpm setup-env`, gitignored). Private key in `.env.keys` (gitignored, shared via 1Password).
- Server config module uses `process.cwd()` for projectRoot — must run from `apps/server/`
