# ADR-0008: Unified Versioning, Separate Deployment

**Date:** 2026-07-28
**Status:** Accepted
**Last revised:** 2026-09-23 — the tag pipeline no longer stops at the GitHub Release: `release.yml` now builds the
images itself and chains `deploy.yml` via `workflow_call`; `deploy.yml` takes an `environment` input (`prod` only).
Version identity is a **single** pnpm `versioning.fixed` group covering all 12 workspace packages (ADR 0011).

## Context

The monorepo contains 3 deployable apps (`admin`, `server`, `docs`) and 9 internal packages (`utils`, `contract`, `types`, `client`, `http`, `ui`, `eslint-config`, `commitlint-config`, `tooling`). A change to `@walnut/contract` affects both admin and server.

The question: when a tag is pushed, should everything deploy together or independently?

## Decision

**One version, one tag, Docker container deploy.**

| Aspect | Approach |
|--------|----------|
| Version | All 12 workspace packages share one version number — a single pnpm `versioning.fixed` group in `pnpm-workspace.yaml` (see ADR 0011) |
| Tag | Single git tag `vX.Y.Z` triggers `release.yml`: `verify` ∥ `images` → GitHub Release → chained deploy |
| Deploy trigger | `deploy.yml` — reusable `workflow_call` (invoked by `release.yml` once the tag's images and Release exist) **plus** manual `workflow_dispatch` for rollback / re-deploy (no `dorny/paths-filter`) |
| Deploy inputs | `image_tag` (required, the release tag to deploy) and `environment` (defaults to `prod`; `prod` is the only option) |
| Deploy order | Backend → nginx → frontend images, built in that order (the frontend Dockerfile builds FROM the nginx image) |
| Backend deploy | `apps/server/Dockerfile` → image pushed to TCR (`ccr.ccs.tencentyun.com`) |
| Frontend deploy | `apps/admin/Dockerfile` → image pushed to TCR, served by the nginx image (`deploy/nginx/Dockerfile`) |
| Orchestration | `docker compose` on the server (`deploy/docker-compose.yml`) |

**Why not deploy everything every time**: Frontend-only changes shouldn't restart the backend. Backend-only changes shouldn't rebuild the frontend. Deployment is a *separate* workflow that only pulls images which were already built and pushed — it never builds anything, so a rollback is a `workflow_dispatch` with an older `image_tag` (1–3 min) instead of a rebuild.

**Why backend first**: New API endpoints must exist before the frontend tries to call them. Database migrations run between backend deploy and frontend deploy. Endpoints must be backward-compatible during the rollout window.

**Why unified versioning**: Small team, tightly coupled packages, `@walnut/contract` changes must stay in sync across frontend and backend. Independent versioning adds coordination overhead without benefit at this scale. Since 2026-09-23 this is mechanically enforced as **one** fixed group (the historical two-group split — Apps + Packages — could bump a shared package without ever producing a tag).

## Alternatives considered

- **Deploy everything every time** —— frontend-only changes should not restart the backend and backend-only changes should not rebuild the frontend; deployment is a separate workflow that only pulls images already built and pushed, so a rollback is a `workflow_dispatch` with an older `image_tag` (1–3 min) instead of a rebuild.
- **Independent (per-package) versioning** —— the team is small, the packages are tightly coupled, and `@walnut/contract` changes must stay in sync across frontend and backend, so independent versioning adds coordination overhead without benefit at this scale; the historical two-group split could bump a shared package without ever producing a tag.

## Consequences

- `deploy.yml` is reusable (`workflow_call`, called by `release.yml`) and manually dispatchable (`workflow_dispatch`) for rollback — no `dorny/paths-filter` needed
- Backend, nginx, and frontend ship as Docker images to TCR (`ccr.ccs.tencentyun.com`); the server runs them via `docker compose` (`deploy/docker-compose.yml`)
- Tag `v1.19.0` triggers `release.yml`, which runs the quality gates in parallel with the image builds, creates the GitHub Release from the tag's committed `changelog-latest.md`, and then chains `deploy.yml` — a tag push therefore deploys automatically; the same tag can be re-deployed later by dispatching `deploy.yml`
- The tag half of the chain (image builds → TCR → served containers) is only as verified as its last real run; the open verification checklist lives in [架构待办事项 P1-16](/content/monorepo/architecture-todo)
- Docs has no deploy job in `deploy.yml` — the docs site deploys independently (VitePress static site)
