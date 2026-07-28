# ADR-0005: JIT for Frontend-Only, CJS Build for Shared Packages

**Date:** 2026-07-28
**Status:** Accepted

## Context

The monorepo has two categories of packages:

| Category | Consumers | Example |
|----------|-----------|---------|
| **Shared** | Frontend + Backend | `@walnut/contract`, `@walnut/utils` |
| **Frontend-only** | Admin SPA only | `@walnut/client`, `@walnut/axios` |

For shared packages, the backend (CJS, SWC) needs build artifacts. For frontend-only packages, Vite handles TypeScript natively.

## Decision

| Package | Build | Frontend Resolution | Backend Resolution |
|---------|-------|-------------------|-------------------|
| `@walnut/contract` | `vite build` (CJS) | `"source"` → raw TS | `"require"` → `.cjs` |
| `@walnut/utils` | `vite build` (CJS) | `"source"` → raw TS | `"require"` → `.cjs` |
| `@walnut/client` | No build (`echo`) | JIT → raw TS | N/A |
| `@walnut/axios` | No build (`echo`) | JIT → raw TS | N/A |

**JIT (Just-In-Time) pattern**: `exports` points to `.ts` source files. Vite resolves and bundles them directly. Zero build latency. Turborepo recommends this for frontend-only packages.

**CJS build pattern**: Vite builds CJS to `dist/*.cjs`. Backend resolves via tsconfig path aliases (for dev) or pnpm workspace resolution (for prod, via `"require"` condition).

## Consequences

- `@walnut/contract` and `@walnut/utils` have a build step (`vite build`). Must run before backend dev/build.
- `@walnut/client` and `@walnut/axios` have no build step. Instant HMR.
- `turbo.json` `build` task has `dependsOn: ["^build"]` so shared packages build before consumers.
