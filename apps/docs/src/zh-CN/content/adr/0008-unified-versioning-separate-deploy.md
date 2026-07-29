# ADR-0008: Unified Versioning, Separate Deployment

**Date:** 2026-07-28
**Status:** Accepted

## Context

The monorepo contains 3 deployable apps (`admin`, `server`, `docs`) and 4 internal packages (`utils`, `contract`, `client`, `axios`). A change to `@walnut/contract` affects both admin and server.

The question: when a tag is pushed, should everything deploy together or independently?

## Decision

**One version, one tag, separate deploy.**

| Aspect | Approach |
|--------|----------|
| Version | All packages share the same version number (e.g., `1.18.0`) |
| Tag | Single git tag triggers CI |
| Deploy trigger | `dorny/paths-filter` in GitHub Actions determines which apps changed |
| Deploy order | Backend first, then frontend |
| Backend deploy | `pnpm deploy --filter @walnut/server --prod` → SCP to VPS → PM2 reload |
| Frontend deploy | Vite build → CDN upload (to be migrated from local deploy-cli-service to GitHub Actions) |

**Why not deploy everything every time**: Frontend-only changes shouldn't restart the backend. Backend-only changes shouldn't rebuild the frontend. Path-based filtering avoids this.

**Why backend first**: New API endpoints must exist before the frontend tries to call them. Database migrations run between backend deploy and frontend deploy. Endpoints must be backward-compatible during the rollout window.

**Why unified versioning**: Small team, tightly coupled packages, `@walnut/contract` changes must stay in sync across frontend and backend. Independent versioning adds coordination overhead without benefit at this scale.

## Consequences

- `deploy.yml` needs `dorny/paths-filter` for conditional job execution
- Frontend deployment moves from local `deploy-cli-service` to GitHub Actions
- Tag `v1.19.0` triggers: backend build → backend deploy (migrations) → frontend build → frontend deploy (CDN)
- Docs deploy is independent (VitePress static site)
