# ADR 0012: Frontend-Backend Toolchain Divergence

**Date:** 2026-07-29
**Status:** Implemented

## Context

Walnut Admin uses two fundamentally different toolchains under one monorepo:

- **Frontend** (`@walnut/admin`): Vite 8 + ESM + `import.meta.env` static replacement
- **Backend** (`@walnut/server`): NestJS CLI + SWC + CJS + `@nestjs/config` runtime env loading

This divergence is not an accident — it reflects the different deployment models (static SPA vs long-running Node process) and has cascading effects on TypeScript configuration, environment variable handling, and Turborepo cache strategy.

## Decision 1: Server tsconfig Does NOT Extend `tsconfig.base.json`

**Chosen:** `apps/server/tsconfig.json` is self-contained. It does NOT extend the root `tsconfig.base.json`.

**Why the root base is incompatible with the server:**

| Option | `tsconfig.base.json` (frontend) | `apps/server/tsconfig.json` (backend) |
|--------|--------------------------------|---------------------------------------|
| `module` | `ESNext` | `commonjs` |
| `moduleResolution` | `bundler` | `node` |
| `target` | `ESNext` | `es2022` |
| `experimentalDecorators` | — (not set) | `true` (required by NestJS) |
| `emitDecoratorMetadata` | — (not set) | `true` (required by NestJS) |
| `noEmit` | `true` (Vite handles output) | `false` (SWC needs `.js` output) |
| `verbatimModuleSyntax` | `true` | incompatible with CJS `require()` |

Forcing the server to extend the root base would require `compilerOptions` overrides for every single divergent field — defeating the purpose of a shared base. Worse, a future developer adding a frontend-oriented option to the base (e.g., `jsx: "preserve"`) could silently break the server build.

**This is permanent.** The CJS-vs-ESM divide is a fundamental property of the architecture, not a transitional state. If a future backend utility is extracted to a pnpm workspace package, it will follow the `@walnut/utils` pattern (Vite CJS build, `require` condition in `exports`), not a shared tsconfig base.

### Non-decision: No shared backend tsconfig base

The deleted `tsconfig.base.node.json` (removed in Phase 2) had **zero consumers** and would continue to have zero consumers — every backend package has unique constraints (decorators, module format, output target). A shared base adds maintenance burden without benefit.

## Decision 2: Environment Variable Loading — Build-time Static vs Runtime

**Chosen:** Explicitly distinguish two env var loading models and their impact on Turborepo caching.

### Frontend: Build-time Static Replacement (Vite)

Vite's `import.meta.env.VITE_*` is a **static replacement** at build time. The literal value is baked into the bundled JavaScript output in `dist/`.

```
Source:  import.meta.env.VITE_APP_TITLE
Build:   "Walnut Admin"           ← statically replaced
```

**Implication:** Any change to a `VITE_*` variable changes the build output. Turborepo must track these variables to correctly invalidate the build cache.

**Scope:** 26 `VITE_*` variables + Vite's built-in `MODE` variable (see `build/vite/config/*.ts` for Zod schemas).

### Backend: Runtime Loading (NestJS ConfigModule)

NestJS uses `@nestjs/config` + `ConfigModule.forRoot()` which reads `.env` files at **process startup**, not at build time. The SWC compiler merely transpiles TypeScript → JavaScript; `process.env.DATABASE_PRIMARY` remains a runtime reference.

```
Source:   process.env.DATABASE_PRIMARY
Build:    process.env.DATABASE_PRIMARY    ← unchanged reference
Runtime:  "mongodb://..."                 ← resolved by ConfigModule
```

**Implication:** Changes to backend env vars do NOT affect the build output. They do NOT need to be declared in Turborepo's `env` field.

**Note:** `NODE_ENV` is the sole exception — it is set via `cross-env` in build scripts and influences which `.env` file ConfigModule loads. It is already declared in `globalEnv`.

### Why dev mode doesn't need env declarations

| Mode | Frontend | Backend |
|------|----------|---------|
| `turbo dev` | `cache: false`, Vite HMR picks up env changes live | `cache: false`, restart server to pick up env changes |
| `turbo build` | `cache: true`, VITE_* baked into dist → **must declare env** | `cache: true`, env refs unchanged → no env declaration needed |

The `env` field in turbo.json matters **only for cached build tasks** (`turbo build` in CI/deploy). Development (`turbo dev`) is unaffected because caching is disabled.

## Decision 3: turbo.json `env` Declaration

**Chosen:** Add `"env": ["VITE_*", "MODE"]` to the `build` task in `turbo.json`.

**Rationale:**
- `VITE_*` wildcard covers all 26 frontend build-time variables (future-proof against additions)
- `MODE` covers Vite's built-in mode switching (`development`/`production`/`stage`)
- Zero impact on `turbo dev` (cache already disabled)
- No other tasks (`lint`, `types:check`, `test`) read env vars

**What this prevents:** Switching between stage and production builds (different Sentry DSN, proxy URLs, CDN flags, etc.) without this declaration would return stale cached output — the build artifacts would contain the wrong API endpoints, wrong Sentry project, or missing CDN configuration.

## Consequences

1. **Turborepo cache correctness:** `turbo build` now correctly invalidates when any `VITE_*` variable or mode changes.
2. **Server tsconfig isolation is documented:** Future maintainers won't try to "fix" the server by making it extend the root base.
3. **Env loading model is explicit:** The build-time-static vs runtime-loading distinction is recorded, preventing confusion about which vars need turbo.json declarations.
4. **The `VITE_*` wildcard pattern is future-proof:** Adding a new `VITE_*` variable to the Zod schema automatically gets cache tracking without touching `turbo.json`.

## Related

- [ADR 0002](0002-dual-mode-consumption.md) — dual-mode package consumption (source for Vite, CJS build for backend)
- [ADR 0005](0005-jit-vs-build.md) — JIT for frontend-only packages, CJS build for shared packages
- [ADR 0007](0007-backend-libs-not-workspace.md) — backend NestJS libraries stay as internal monorepo
- `docs/architecture/05-tsconfig-strategy.md` — detailed tsconfig topology
