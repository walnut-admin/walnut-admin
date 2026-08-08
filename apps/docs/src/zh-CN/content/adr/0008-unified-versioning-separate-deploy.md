# ADR-0008: Unified Versioning, Separate Deployment

**Date:** 2026-07-28
**Status:** Accepted

## Context

The monorepo contains 3 deployable apps (`admin`, `server`, `docs`) and 9 internal packages (`utils`, `contract`, `types`, `client`, `http`, `ui`, `eslint-config`, `release`, `commitlint-config`). A change to `@walnut/contract` affects both admin and server.

The question: when a tag is pushed, should everything deploy together or independently?

## Decision

**One version, one tag, Docker container deploy.**

| Aspect | Approach |
|--------|----------|
| Version | All packages share the same version number (e.g., `1.18.0`) |
| Tag | Single git tag triggers `release.yml` — creates the GitHub Release only, no deployment |
| Deploy trigger | `deploy.yml` — manual `workflow_dispatch` (no `dorny/paths-filter`) |
| Deploy order | Backend → nginx → frontend images, built in that order (the frontend Dockerfile builds FROM the nginx image) |
| Backend deploy | `apps/server/Dockerfile` → image pushed to TCR (`ccr.ccs.tencentyun.com`) |
| Frontend deploy | `apps/admin/Dockerfile` → image pushed to TCR, served by the nginx image (`deploy/nginx/Dockerfile`) |
| Orchestration | `docker compose` on the server (`deploy/docker-compose.yml`) |

**Why not deploy everything every time**: Frontend-only changes shouldn't restart the backend. Backend-only changes shouldn't rebuild the frontend. Deployment is triggered manually via `workflow_dispatch`, so nothing deploys unless explicitly started.

**Why backend first**: New API endpoints must exist before the frontend tries to call them. Database migrations run between backend deploy and frontend deploy. Endpoints must be backward-compatible during the rollout window.

**Why unified versioning**: Small team, tightly coupled packages, `@walnut/contract` changes must stay in sync across frontend and backend. Independent versioning adds coordination overhead without benefit at this scale.

## Consequences

- `deploy.yml` is a manual `workflow_dispatch` — no `dorny/paths-filter` needed
- Backend, nginx, and frontend ship as Docker images to TCR (`ccr.ccs.tencentyun.com`); the server runs them via `docker compose` (`deploy/docker-compose.yml`)
- Tag `v1.19.0` triggers `release.yml` only — creates the GitHub Release; actual deployment is a manual `deploy.yml` run
- Docs has no deploy job in `deploy.yml` — the docs site deploys independently (VitePress static site)
