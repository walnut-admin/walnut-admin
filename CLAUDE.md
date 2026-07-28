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

**Key versions:** Node >= 24.13.0, pnpm >= 11.0.0, TypeScript 6.0.3, Turbo 2.4.0

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
pnpm test           # Run tests (currently only @walnut/server has vitest configured)
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
│   │   ├── env/             — env templates (placeholders)
│   │   ├── env-encrypted/    — encrypted env (committed, dotenvx)
│   │   └── env-local/       — local env (real values, gitignored, generated)
│   └── docs/                — Vitepress documentation site
├── packages/                ← Shared libraries (consumed by apps)
│   ├── utils/     @walnut/utils        — pure utilities (regex, queue, crypto/const,
│   │                                      crypto/transformer). CJS build for backend
│   │                                      consumption, source for frontend.
│   ├── contract/  @walnut/contract     — shared types & constants (response codes,
│   │                                      enums, pagination, API contracts).
│   │                                      CJS build for backend consumption.
│   ├── client/    @walnut/client       — browser utilities + Vue composables
│   │                                      (crypto, file, window, storage, hooks)
│   │                                      (crypto, storage, file utils). Source-only.
│   └── axios/    @walnut/axios         — HTTP client framework (instance + adapters)
├── build/                    ← Shared Vite build config
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
- **Frontend packages** (`@walnut/shared`, `@walnut/axios`, `@walnut/core`): ESM, pnpm workspace, Vite-compiled, framework-level. The `@walnut/*` scope (without `-server`) is reserved for these.

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
- ✅ Dependencies unified via pnpm `catalog:` (47 entries, single source of truth — ESLint version drift resolved)

**For full architecture details and the remaining refactor roadmap:**
- [`docs/architecture/`](./docs/architecture/README.md) — authoritative architecture docs (8 files)
- [`docs/architecture/07-known-issues.md`](./docs/architecture/07-known-issues.md) — 13 issues tracked, 7 resolved
- [`docs/architecture/08-refactor-plan.md`](./docs/architecture/08-refactor-plan.md) — 5-phase plan with file/line precision
- `migration-guide/` — historical migration record (Phase 1 merge steps, now completed)

## Frontend Architecture (apps/admin/)

- **Vue 3** Composition API + `<script setup>`
- **Naive UI** component library with auto-registration
- **UnoCSS** utility CSS (Wind preset, Tailwind v3 compatible)
- **Pinia** stores, **Vue Router** (web history), **Vue I18n**
- **Auto-imports**: `unplugin-auto-import` + `unplugin-vue-components`
- **Path alias**: `@/*` → `apps/admin/src/*`, `~/*` → `apps/admin/types/*`
- **Security**: OPAQUE password, WebAuthn/FIDO2, MFA/OTP, RSA encryption, device fingerprinting
- **Build**: Vite 8 with optional obfuscation, CDN, PWA, Sentry, CSP
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
- Environment: `env/` (templates) → `env-encrypted/` (committed, AES-256 encrypted via dotenvx) → `env-local/` (plaintext, generated by `pnpm setup-env`). Private key in `.env.keys` (gitignored, shared via 1Password).
- Server config module uses `process.cwd()` for projectRoot — must run from `apps/server/`
