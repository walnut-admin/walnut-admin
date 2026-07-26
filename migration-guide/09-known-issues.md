# Known Issues: Monorepo Migration

> **Living Document** — This file tracks all known issues discovered during the monorepo migration that need follow-up. As issues are resolved, their status is updated but the record is never deleted (for historical traceability).
>
> **Last Updated**: 2026-07-26

---

## Issue Tracker

| # | Issue | Status | Discovered During | Impact | Priority |
|---|---|---|---|---|---|
| 1 | ESLint version mismatch across packages | Open | 03-admin-adapt.md | Lint consistency | Medium |
| 2 | `@antfu/eslint-config` version mismatch | Open | 03-admin-adapt.md | Lint compatibility | Low |
| 3 | pnpm 11 `onlyBuiltDependencies` (allowBuilds) | Open | 07-install-verify.md | Install success | High |
| 4 | Server SWC `baseUrl` path mismatch | Open | 04-server-adapt.md | Server build | High |
| 5 | Server ConfigModule `projectRoot` computation | Open | 04-server-adapt.md | Server dev startup | High |
| 6 | Server build output path uses old naming | Open | 04-server-adapt.md | Deployment config | Low |
| 7 | Server scripts use `set` for NODE_ENV (Windows) | Fixed | 04-server-adapt.md | Cross-platform dev | Closed |
| 8 | Docs Vitepress Node 24 compatibility | Untested | 07-install-verify.md | Docs build | Medium |
| 9 | Root `dev` script starts ALL apps simultaneously | Open | 07-install-verify.md | Developer UX | Medium |
| 10 | Git history lost in monorepo merge | Open | 02-merge-strategy.md | History traceability | Low |
| 11 | Auto-import resolvers may need path updates | Open | 07-install-verify.md | Admin dev startup | Medium |
| 12 | TypeScript path aliases across workspace packages | Open | 07-install-verify.md | type:check | High |
| 13 | Build output directory configuration per app | Open | 03-admin-adapt.md | CI/CD configuration | Medium |
| 14 | Turborepo cache invalidation timing | Open | 07-install-verify.md | Build performance | Low |
| 15 | `pnpm dev` vs `turbo dev` behavior confusion | Open | 07-install-verify.md | Developer onboarding | Medium |

---

## Issue Details

### Issue 1: ESLint Version Mismatch

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 03-admin-adapt.md — ESLint configuration per app |
| **Impact** | Lint may produce different results per app; `pnpm lint` at root may not run uniformly |
| **Priority** | Medium |

**Description**:
Each app uses a different ESLint version:

| App | ESLint Version |
|---|---|
| Root (monorepo) | 10.3.0 |
| Admin (`apps/admin/`) | 10.3.0 (inherits root) |
| Server (`apps/server/`) | 10.1.0 |
| Docs (`apps/docs/`) | 9.30.1 |

This is not immediately blocking because each app's ESLint runs in its own context via Turborepo. However:
- Inconsistent lint rules across packages produce developer confusion
- Root `pnpm lint` aggregates all lint results but cannot use a unified config
- ESLint 9.x (docs) lacks features that 10.x has

**Proposed Fix**:
- Phase 3 or later: Upgrade docs' ESLint to match root version
- Server's 10.1.0 vs root's 10.3.0 is a minor difference and likely compatible
- Consider standardizing on a single ESLint config package version across the monorepo

---

### Issue 2: `@antfu/eslint-config` Version Mismatch

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 03-admin-adapt.md — ESLint configuration per app |
| **Impact** | Breaking changes in newer versions may produce unexpected lint results; docs' old version (4.x) may fail on Node 24 |
| **Priority** | Low |

**Description**:

| App | `@antfu/eslint-config` Version |
|---|---|
| Root / Admin | 8.2.0 |
| Server | 8.0.0 |
| Docs | 4.16.2 |

The docs app uses a very old version (4.x) that has a fundamentally different configuration API. The 4.x series used the old flat config format before `@antfu/eslint-config` standardized it.

**Proposed Fix**:
- Upgrade docs to `@antfu/eslint-config@8.x` to match the rest of the monorepo
- This will likely require updating `apps/docs/eslint.config.*` files to the new API
- May be a significant effort if the docs eslint config has many custom rules

---

### Issue 3: pnpm 11 `onlyBuiltDependencies` (allowBuilds)

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 07-install-verify.md — Fresh `pnpm install` |
| **Impact** | `pnpm install` fails if packages need build scripts |
| **Priority** | High |

**Description**:
pnpm 11 introduced a security feature requiring explicit opt-in for packages that run build/install scripts (formerly `pnpm.onlyBuiltDependencies` in package.json or `onlyBuiltDependencies` in `pnpm-workspace.yaml`).

**Unknown at migration time**:
Which packages need to be added is not known until `pnpm install` runs. Likely candidates based on the dependency graph:

| Package | Likely Needs allowBuilds? | Reason |
|---|---|---|
| `esbuild` | Yes | Used by Vite and SWC |
| `swc` | Yes | Used by NestJS SWC builder |
| `sharp` | Maybe | Used in image processing (current? unknown) |
| `node-gyp` | Maybe | Native addon compilation |
| `sass` | Maybe | Dart Sass has binary download |

**Resolution**:
```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - esbuild
  - swc
```

If using pnpm <11 with `--shamefully-hoist`, this field is unnecessary. In pnpm 11, it is mandatory.

**Proposed Fix**:
- Run `pnpm install` and note every package that triggers an allowBuilds error
- Add each to `onlyBuiltDependencies` in `pnpm-workspace.yaml`
- Re-run until clean

---

### Issue 4: Server SWC `baseUrl` Path Mismatch

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 04-server-adapt.md — NestJS SWC adaptation |
| **Impact** | Server build fails with SWC compilation errors |
| **Priority** | High |

**Description**:
The server's `.swcrc` file contains a `baseUrl` that was relative to the old repository root. After moving to `apps/server/`, the `baseUrl` may no longer resolve correctly.

**Typical `.swcrc` content**:
```json
{
  "jsc": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

**Problem**: `baseUrl: "."` resolves to `apps/server/` when running `pnpm dev:server` from the monorepo root (because NestJS's SWC builder runs relative to the app directory). But if any path references the old project root (e.g., `libs/` references), they may break.

**Resolution**:
Verify by running:
```bash
pnpm dev:server
# or
cd apps/server && npx nest build --builder swc
```

If SWC errors mention `Cannot find module`, check:
1. `.swcrc` `baseUrl` — may need `".."` or `"../.."` if paths reference monorepo root
2. `tsconfig.json` `paths` — must be consistent with the new `apps/server/` location

**Proposed Fix**:
- Set `baseUrl` to `"."` (should work in most cases since NestJS runs from `apps/server/`)
- If external references are needed (e.g., `packages/*`), use relative paths or workspace references instead of SWC path mapping

---

### Issue 5: Server ConfigModule `projectRoot` Computation

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 04-server-adapt.md — Server adaptation |
| **Impact** | Server fails to find `env-local/` directory; environment variables not loaded |
| **Priority** | High |

**Description**:
The server's custom `ConfigModule` in `libs/config` computes the project root to locate `env-local/` files. The computation likely uses `process.cwd()` or `__dirname` traversal. After the move to `apps/server/`, this computation may return the monorepo root (`D:/walnut/walnut-admin/`) instead of the server root (`D:/walnut/walnut-admin/apps/server/`).

**Symptom**:
```
Error: env-local/ not found. Please create .env.development in env-local/
```

**Proposed Fix**:
- Locate the `projectRoot` computation in the ConfigModule source (likely in `apps/server/libs/config/src/`)
- Adjust the traversal logic to account for the additional `apps/server/` nesting
- Options:
  - Use `__dirname` relative to a known file location
  - Add a `PROJECT_ROOT` environment variable override
  - Search upward from `__dirname` looking for `apps/server/env-local/` then fall back to `env-local/`

---

### Issue 6: Server Build Output Path Uses Old Naming

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 04-server-adapt.md — Server build configuration |
| **Impact** | Deployment scripts may reference wrong output path |
| **Priority** | Low |

**Description**:
NestJS builds to a path like `dist/walnut/admin/com/app/main.js` (reflecting the old Java-style package naming). This path is defined in `nest-cli.json` or `tsconfig.json` and predates the monorepo migration.

**Current path**: `dist/walnut/admin/com/app/main.js`
**Expected path**: `dist/apps/server/main.js` (monorepo convention) or similar

**Proposed Fix**:
- Review `apps/server/nest-cli.json` for the `entryFile` and `tsCompiler.options.outDir`
- Consider updating to a simpler output path
- Update deployment scripts (Dockerfile, CI config) to use the new path

---

### Issue 7: Server Scripts Use `set` for NODE_ENV (Windows)

| Field | Value |
|---|---|
| **Status** | Fixed in Phase 1 |
| **Discovered During** | 04-server-adapt.md — Cross-env replacement |
| **Impact** | Already resolved — documented for posterity |
| **Priority** | Closed |

**Description**:
Original server `package.json` scripts used Windows-style `set NODE_ENV=development` syntax:
```json
{
  "scripts": {
    "start": "set NODE_ENV=development && node dist/main.js"
  }
}
```

This does not work cross-platform (fails on Linux/macOS bash).

**Fix Applied**:
Replaced with `cross-env`:
```json
{
  "scripts": {
    "start": "cross-env NODE_ENV=development node dist/main.js"
  }
}
```

`cross-env` was added to the server's `devDependencies`. If other internal scripts or shell files contain `set NODE_ENV=...`, they should also be updated.

**Remaining risk**: Check for `set NODE_ENV` in:
- `apps/server/scripts/*.sh`
- `apps/server/package.json` (other scripts)
- `apps/server/Makefile` (if exists)

---

### Issue 8: Docs Vitepress Node 24 Compatibility

| Field | Value |
|---|---|
| **Status** | Untested |
| **Discovered During** | 07-install-verify.md — Docs dev startup |
| **Impact** | Docs build or dev server may fail on Node 24 |
| **Priority** | Medium |

**Description**:
The docs app uses Vitepress. The specific version depends on the docs' `package.json`. Common versions:

| Vitepress Version | Vite Version | Node 24 Compatibility |
|---|---|---|
| 1.6.3 | 5.4.19 | Untested, likely compatible |
| 1.7.x | 6.x | Should work |

Node 24 introduced some V8 API changes that may affect dependency tree walking. If Vitepress fails on Node 24, the options are:
1. Pin Node version to 22 via `.nvmrc` or `engines` field
2. Upgrade Vitepress to a version that supports Node 24

**Proposed Fix**:
- Test `pnpm dev:docs` on Node 24
- If it fails, add `"node": ">=20.0.0 <25"` to `apps/docs/package.json` `engines` field
- Create `.nvmrc` at root with `22` or `lts/*`

---

### Issue 9: Root `dev` Script Starts ALL Apps Simultaneously

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 07-install-verify.md — Dev server verification |
| **Impact** | Developer runs `pnpm dev` expecting one app, gets three |
| **Priority** | Medium |

**Description**:
The root `package.json` likely has:
```json
{
  "scripts": {
    "dev": "turbo dev"
  }
}
```

Turborepo's `dev` command starts ALL persistent tasks across all apps (admin, server, docs). This is extremely resource-intensive and may fail if MongoDB/Redis are not running (server will crash).

**Per-app scripts** (should already exist):
```json
{
  "scripts": {
    "dev:admin": "pnpm --filter @walnut/admin dev",
    "dev:server": "pnpm --filter @walnut/server dev",
    "dev:docs": "pnpm --filter @walnut/docs dev",
    "build:admin": "pnpm --filter @walnut/admin build",
    "build:server": "pnpm --filter @walnut/server build",
    "build:docs": "pnpm --filter @walnut/docs build"
  }
}
```

**Proposed Fix**:
- Keep `pnpm dev` as is for power users who want everything running
- Document clearly that `pnpm dev:admin` is the usual workflow for frontend developers
- Consider adding a `pnpm dev:web` alias for `dev:admin` to match conventions

---

### Issue 10: Git History Lost in Monorepo Merge

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 02-merge-strategy.md — Merge approach |
| **Impact** | Cannot `git blame` or `git log` to find original commits from separate repos |
| **Priority** | Low |

**Description**:
The monorepo was created by copying files from three separate repositories, not by using `git subtree` or `git filter-repo` to preserve history. As a result:

- `git blame` on any file shows the initial monorepo commit, not the original author
- `git log --follow` cannot trace changes to the original repos
- Historical context (why a change was made, PR discussions) is not available in this repo

**Proposed Fix**:
- The three old repos are archived separately. Point users to them:
  ```
  Old repos (archived):
  - https://github.com/org/walnut-admin-client  (now apps/admin/)
  - https://github.com/org/walnut-admin-server  (now apps/server/)
  - https://github.com/org/walnut-admin-docs    (now apps/docs/)
  ```
- Add a `CONTRIBUTING.md` or `HISTORY.md` note explaining where to find old history
- If history preservation is critical, consider using `git replace` grafts (complex, not recommended for most teams)

---

### Issue 11: Auto-import Resolvers May Need Path Updates

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 07-install-verify.md — Admin dev startup |
| **Impact** | Components not auto-imported on dev startup; TypeScript errors in templates |
| **Priority** | Medium |

**Description**:
The admin app uses `unplugin-auto-import` and `unplugin-vue-components` to auto-import APIs and components. After moving the app to `apps/admin/`, the resolvers' path configuration may point to old locations.

**Check**:
- `apps/admin/vite.config.ts` or `build/vite/plugins/autoImport.ts` — the resolvers configuration
- If resolvers use hardcoded paths like `../../src/components/`, they may now reference the wrong directory

**Example fix**:
```typescript
// Before (old location)
// After (new location relative to apps/admin/)
AutoImport({
  imports: ['vue', 'vue-router', 'pinia', '@vueuse/core'],
  dirs: ['./src/hooks/**', './src/store/**', './src/utils/**'],
})

Components({
  dirs: [
    './src/components/UI/**',
    './src/components/Business/**',
    './src/components/Advanced/**',
  ],
})
```

---

### Issue 12: TypeScript Path Aliases Across Workspace Packages

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 07-install-verify.md — type:check |
| **Impact** | `vue-tsc --noEmit` may fail with resolution errors for cross-package imports |
| **Priority** | High |

**Description**:
TypeScript path aliases (`@/*` → `src/*`) work within a single package but may not resolve correctly when importing from workspace packages.

**Common problems**:
1. `@walnut/types` uses `packages/types/src/index.ts` — the admin app references it via `@walnut/types`, not via a path alias
2. If a package's internal imports use relative paths like `../src/foo`, they can break when the package is consumed from outside
3. Vue SFC type checking across packages requires `vue-tsc` to traverse workspace references

**Resolution**:
- Ensure every workspace package has a correct `tsconfig.json` with `"composite": true` and `"declaration": true`
- The root `tsconfig.json` should have `"references"` pointing to all workspace packages
- Each app's `tsconfig.json` should have `"references"` pointing to the packages it uses

```json
// apps/admin/tsconfig.json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "~/*": ["../../types/*"]
    }
  },
  "references": [
    { "path": "../../packages/types" },
    { "path": "../../packages/util" },
    { "path": "../../packages/http" },
    { "path": "../../packages/ui" }
  ]
}
```

---

### Issue 13: Build Output Directory Configuration Per App

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 03-admin-adapt.md — Admin adaptation |
| **Impact** | Build artifacts may go to unexpected locations; CI/CD must know correct paths |
| **Priority** | Medium |

**Description**:
Each app may have a different build output configuration inherited from its original repository. In the monorepo, these need to be consistent:

| App | Build Tool | Output Dir (old) | Output Dir (desired) |
|---|---|---|---|
| Admin | Vite | `dist/` (old project root) | `apps/admin/dist/` |
| Server | NestJS + SWC | `dist/` (old project root) | `apps/server/dist/` |
| Docs | VitePress | `dist/` (old project root) | `apps/docs/dist/` |

**Resolution**:
- Vite (admin): `build.outDir` in `vite.config.ts` or `VITE_BUILD_OUT_DIR` env var
- NestJS (server): `nest-cli.json` `compilerOptions.outDir`
- VitePress (docs): `dest` in `.vitepress/config.ts`

Ensure these output directories are in `.gitignore`.

---

### Issue 14: Turborepo Cache Invalidation Timing

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 07-install-verify.md — Full build |
| **Impact** | Turborepo may use stale cache when inputs haven't changed, hiding issues |
| **Priority** | Low |

**Description**:
Turborepo caches build outputs based on file hashes. If a workspace package's `package.json` changes but its actual source doesn't, Turborepo may still use the cached output. Conversely, if the caching configuration is too strict, it may invalidate cache unnecessarily.

**Recommended `turbo.json` configuration**:
```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".turbo/**"],
      "inputs": ["src/**", "tsconfig.json", "package.json"],
      "cache": true
    },
    "types:check": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": true
    }
  }
}
```

Force cache bypass when needed:
```bash
pnpm build --force
```

---

### Issue 15: `pnpm dev` vs `turbo dev` Behavior Confusion

| Field | Value |
|---|---|
| **Status** | Open |
| **Discovered During** | 07-install-verify.md — Developer experience |
| **Impact** | New developers run `pnpm dev` and see unexpected behavior |
| **Priority** | Medium |

**Description**:
Turborepo's `dev` command runs ALL persistent development tasks across all apps simultaneously (admin Vite dev server, server NestJS watch mode, docs VitePress dev server). This is:

1. **Resource intensive** — Running three dev servers simultaneously can consume 2-4GB of RAM
2. **Confusing** — New developers expect only one app to start
3. **Brittle** — If MongoDB is not running, the server crashes, which may exit the entire `turbo dev` process

**Current state**:
```json
// root package.json
{
  "scripts": {
    "dev": "turbo dev", // starts ALL apps
    "dev:admin": "pnpm --filter @walnut/admin dev",
    "dev:server": "pnpm --filter @walnut/server dev",
    "dev:docs": "pnpm --filter @walnut/docs dev"
  }
}
```

**Recommendation**:
- Change root `dev` to start only the admin app (the most common development target)
- Or add a package.json comment and README note clarifying usage
- Document that `pnpm dev:server` requires MongoDB + Redis

---

## How to Update This Document

1. When a new issue is discovered, add a new row to the tracker table and a new detailed section
2. When an issue is resolved, update its Status to "Fixed" and add the resolution date and commit hash
3. Never delete an issue entry — stale records provide historical context
4. Update "Last Updated" date at the top of the file

---

## Issue Lifecycle

```
Open → In Progress → Resolved/Fixed → Closed
  │                                      │
  └──→ WontFix (documented decision) ────┘
```

- **Open**: Known but not being actively worked on
- **In Progress**: Someone is actively investigating or fixing
- **Fixed**: A fix has been merged to the main branch
- **Closed**: Verified fixed and no further action needed
- **WontFix**: Accepted as a known limitation (with rationale)

---

> **Next**: Phase 2 begins with [08-phase2-packages.md](./08-phase2-packages.md)
