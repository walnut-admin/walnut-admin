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
```

## Monorepo Architecture

```
walnut-admin/
├── apps/                    ← Deployable applications
│   ├── admin/               — Vue3 SPA (full frontend app)
│   ├── server/              — NestJS API (own internal monorepo)
│   │   ├── apps/api/        — NestJS application entry
│   │   ├── libs/            — 9 NestJS internal libraries
│   │   │   ├── config/      @walnut/config      — env config + validation
│   │   │   ├── const/       @walnut/const       — constants + error codes
│   │   │   ├── context/     @walnut/context     — ALS context
│   │   │   ├── db/          @walnut/db          — Mongoose + transactions
│   │   │   ├── decorators/  @walnut/decorators  — custom decorator system
│   │   │   ├── exceptions/  @walnut/exceptions  — exceptions + global filter
│   │   │   ├── pipes/       @walnut/pipes       — param pipes
│   │   │   ├── types/       @walnut/types       — type declarations
│   │   │   └── utils/       @walnut/utils       — utilities
│   │   ├── infra/nest/      — nest-cli build configs (dev/stage/prod)
│   │   ├── infra/swc/       — SWC compiler configs
│   │   ├── env/             — env templates (placeholders)
│   │   └── env-local/       — local env (real values, gitignored)
│   └── docs/                — Vitepress documentation site
├── packages/                ← Shared libraries (consumed by apps)
│   ├── shared/  @walnut/shared   — zero-dependency base layer
│   ├── axios/   @walnut/axios    — HTTP client + interceptors
│   ├── core/    @walnut/core     — stores, router, hooks, socket
│   ├── ui/      @walnut/ui       — WTable/WForm/CRUD components
│   └── ai/      @walnut/ai       — AI chat subsystem
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
- **Server libs** (`@walnut/config`, `@walnut/db`, etc.): CommonJS, tsconfig paths, SwC-compiled, NestJS-coupled
- **Frontend packages** (`@walnut/shared`, `@walnut/ui`, etc.): ESM, pnpm workspace, Vite-compiled, framework-level

There is NO name collision — the two `@walnut/*` scopes resolve via different mechanisms and have no overlapping package names.

## Current State: Phase 1 Migration Complete

This monorepo was created by merging three previously separate repositories:
- `walnut-admin-client` → `apps/admin/` + root workspace config
- `walnut-admin-server` → `apps/server/`
- `walnut-admin-doc` → `apps/docs/`

**What has been done:**
- All three repos copied into the monorepo
- Root config updated for Node 24 + pnpm 11
- Server scripts adapted (cross-env, typecheck→types:check)
- Docs adapted
- Dependencies installed successfully (3016 packages, 9 workspace projects)

**What still needs work (see migration-guide/):**
- Packages redesign (Phase 2) — extract business logic from packages/, create proper reusable libraries
- CI/CD merge — combine server and client GitHub Actions
- SWC path verification — confirm paths work in NestJS build
- ESLint version unification — server (10.1.0) and docs (9.30.1) differ from root (10.3.0)
- Known issues tracked in `migration-guide/09-known-issues.md`

See `migration-guide/README.md` for the full step-by-step plan.

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
- Environment: `env-local/` (dev) vs `env/` (prod/stage), loaded by `@walnut/config`
- Server config module uses `process.cwd()` for projectRoot — must run from `apps/server/`
