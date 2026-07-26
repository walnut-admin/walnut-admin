<!-- PROJECT LOGO -->
<p align="center">
  <a href="">
    <img src="https://github.com/walnut-admin/walnut-admin-client/blob/main/public/logo.png" alt="Logo" width="80" height="80">
  </a>

  <h1 align="center">Walnut Admin</h1>
  <p align="center">
    A full-stack back-office management system — Vue3 + NestJS + MongoDB
    <br />
    <a target="_blank" href="https://walnut-admin-doc.netlify.app/"><strong>Explore the docs »</strong></a>
    <br />
    <br />
    <a target="_blank" href="https://www.walnut-admin.com">View Demo</a>
    ·
    <a target="_blank" href="https://github.com/walnut-admin/walnut-admin/issues">Report a Bug</a>
  </p>
</p>

## Monorepo Structure

```
walnut-admin/
├── apps/
│   ├── admin/    @walnut/admin   — Vue3 SPA (管理后台)
│   ├── server/   @walnut/server  — NestJS API (后端服务)
│   └── docs/     @walnut/docs    — Vitepress (文档站)
├── packages/                     — Frontend shared libraries (consumed by apps/admin)
│   ├── shared/   @walnut/shared   — zero-dependency base (crypto, storage, types)
│   ├── axios/    @walnut/axios    — HTTP client framework (instance + adapters)
│   └── core/     @walnut/core     — generic composables/hooks
├── turbo.json                    — Turborepo pipeline
├── pnpm-workspace.yaml           — pnpm workspace config
└── migration-guide/              — Migration documentation
```

## Quick Start

**Requirements:** Node.js >= 24.13.0, pnpm >= 11.0.0

```bash
pnpm install

# Start individual apps
pnpm dev           # = pnpm dev:admin (frontend only, the common case)
pnpm dev:admin     # Frontend → http://localhost:3100
pnpm dev:server    # Backend  → requires MongoDB + Redis
pnpm dev:docs      # Docs     → http://localhost:8886

# Build
pnpm build:admin
pnpm build:server
pnpm build:docs

# Lint & type check
pnpm lint
pnpm types:check
pnpm test          # Run tests (only @walnut/server has vitest configured)
```

## History

This monorepo was created by merging three previously separate repositories:
- [walnut-admin-client](https://github.com/walnut-admin/walnut-admin-client) — Vue3 frontend (now `apps/admin/`)
- [walnut-admin-server](https://github.com/walnut-admin/walnut-admin-server) — NestJS backend (now `apps/server/`)
- [walnut-admin-doc](https://github.com/walnut-admin/walnut-admin-doc) — Vitepress docs (now `apps/docs/`)

See [migration-guide/](./migration-guide/) for the historical migration record, and [docs/architecture/](./docs/architecture/README.md) for the current architecture documentation and refactor roadmap.
