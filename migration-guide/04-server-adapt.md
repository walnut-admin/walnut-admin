# Step 4: Adapt `apps/server/` After Copy

This step covers the changes needed after copying the `walnut-admin-server` repository contents into `apps/server/`. The goal is to make the server package work as a pnpm workspace package managed by turbo.

**Assumption:** The server source has been copied from `D:/walnut/walnut-admin-server/` into `D:/walnut/walnut-admin/apps/server/`. All original files are preserved at the time of copy.

---

## 4a: Update `apps/server/package.json`

**File:** `D:/walnut/walnut-admin/apps/server/package.json`

### Before (original from walnut-admin-server)

```json
{
  "name": "walnut-admin-nestjs",
  "version": "1.18.0",
  "description": "An admin template, using `vue3`,`ts`,`vite`,`naive-ui`. Continuously updating...",
  "private": true,
  "author": {
    "name": "zhaocl97",
    "email": "zhaocl97@foxmail.com",
    "url": "https://github.com/Zhaocl1997"
  },
  "config": { "domain": "walnut-admin.com" },
  "license": "MIT",
  "homepage": "https://github.com/walnut-admin",
  "repository": {
    "type": "git",
    "url": "https://github.com/walnut-admin/walnut-admin-server.git"
  },
  "bugs": { "url": "https://github.com/walnut-admin/walnut-admin-server/issues" },
  "simple-git-hooks": {
    "pre-commit": "npx lint-staged"
  },
  "lint-staged": {
    "*.ts": "eslint --fix --concurrency=auto"
  },
  "scripts": {
    "preinstall": "npx only-allow pnpm && npx simple-git-hooks",
    "build": "set NODE_ENV=production&& nest build -c infra/nest/prod.json",
    "build:libs": "concurrently \"nest build config\" \"nest build const\" \"nest build db\" \"nest build utils\" \"nest build types\" \"nest build decorators\" \"nest build pipes\" \"nest build exceptions\"",
    "build:stage": "set NODE_ENV=stage&& nest build -c infra/nest/stage.json",
    "dev": "set NODE_ENV=development&& nest start api --watch -c infra/nest/dev.json",
    "start:debug": "nest start --debug --watch",
    "start:prod": "NODE_ENV=production node dist/walnut/admin/com/app/main.js",
    "start:stage": "NODE_ENV=stage node dist/walnut/admin/com/app/main.js",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix --concurrency=auto",
    "typecheck": "tsc --noEmit --pretty",
    "typecheck:watch": "tsc --noEmit --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --inspect --logHeapUsage --threads=false",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
    "test:pw": "esno playwright/example.ts",
    "changelog": "esno scripts/release/changelog.ts",
    "git:push": "esno scripts/release/git.ts",
    "pm2:prod": "NODE_ENV=production pm2 start dist/walnut/admin/com/app/main.js --name walnut-admin-nestjs-prod",
    "pm2:stage": "NODE_ENV=stage pm2 start dist/walnut/admin/com/app/main.js --name walnut-admin-nestjs-stage",
    "gen:doc": "@compodoc/compodoc -p tsconfig.json -s",
    "check:update": "npm-check-updates -i",
    "nmi": "node-modules-inspector",
    "madge": "madge --circular src/walnut/admin/com/app --extensions js,ts,tsx"
  },
  "dependencies": { ... },
  "devDependencies": {
    ...
    // NOTE: does NOT include cross-env
    ...
  },
  "engines": {
    "node": ">=24.13.0",
    "npm": ">=11.6.2"
  },
  "packageManager": "pnpm@10.33.0"
}
```

### After (adapted for monorepo)

```json
{
  "name": "@walnut/server",
  "version": "1.18.0",
  "private": true,
  "description": "Walnut Admin Server - NestJS backend",
  "author": {
    "name": "zhaocl97",
    "email": "zhaocl97@foxmail.com",
    "url": "https://github.com/Zhaocl1997"
  },
  "license": "MIT",
  "scripts": {
    "build": "cross-env NODE_ENV=production nest build -c infra/nest/prod.json",
    "build:libs": "concurrently \"nest build config\" \"nest build const\" \"nest build db\" \"nest build utils\" \"nest build types\" \"nest build decorators\" \"nest build pipes\" \"nest build exceptions\"",
    "build:stage": "cross-env NODE_ENV=stage nest build -c infra/nest/stage.json",
    "dev": "cross-env NODE_ENV=development nest start api --watch -c infra/nest/dev.json",
    "start:debug": "nest start --debug --watch",
    "start:prod": "cross-env NODE_ENV=production node dist/walnut/admin/com/app/main.js",
    "start:stage": "cross-env NODE_ENV=stage node dist/walnut/admin/com/app/main.js",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix --concurrency=auto",
    "types:check": "tsc --noEmit --pretty",
    "typecheck:watch": "tsc --noEmit --watch",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:cov": "vitest run --coverage",
    "test:debug": "vitest --inspect-brk --inspect --logHeapUsage --threads=false",
    "test:e2e": "vitest run --config ./vitest.config.e2e.ts",
    "test:pw": "esno playwright/example.ts",
    "preview": "echo preview-not-configured",
    "clean": "echo clean-not-configured"
  },
  "dependencies": { ... /* same as original */ },
  "devDependencies": {
    ... /* same as original, PLUS: */,
    "cross-env": "^7.0.3"
  },
  "engines": {
    "node": ">=24.13.0"
  }
}
```

### Detailed diffs

**1. Name change (required for workspace resolution):**
```diff
- "name": "walnut-admin-nestjs",
+ "name": "@walnut/server",
```
**Why:** The monorepo uses `@walnut/*` scoped naming (admin, server, docs, etc.). This also allows turbo filtering (`--filter=@walnut/server`).

**2. Add `private: true` (it already had it, kept):**
No diff needed. It was already `"private": true`.

**3. Remove `"packageManager"`:**
```diff
- "packageManager": "pnpm@10.33.0",
```
**Why:** The root `package.json` manages the pnpm version for the entire monorepo. Each individual workspace package should not pin its own package manager version.

**4. Simplify `engines`:**
```diff
- "engines": { "node": ">=24.13.0", "npm": ">=11.6.2" }
+ "engines": { "node": ">=24.13.0" }
```
**Why:** The `npm` requirement is irrelevant in a pnpm workspace. pnpm installs and manages everything.

**5. Remove `preinstall` script:**
```diff
- "preinstall": "npx only-allow pnpm && npx simple-git-hooks",
```
**Why:** The root `package.json` already has `preinstall: "npx only-allow pnpm"` and `postinstall: "npx simple-git-hooks"`. Having the server package also run `simple-git-hooks` would be redundant, and `only-allow pnpm` would block `pnpm -w add ...` from the workspace root when the server's preinstall hook fires. Remove the entire line.

**6. Rename `typecheck` to `types:check`:**
```diff
- "typecheck": "tsc --noEmit --pretty",
+ "types:check": "tsc --noEmit --pretty",
```
**Why:** Turbo's `turbo.json` defines a `types:check` pipeline task. All packages must expose a `types:check` script for turbo to orchestrate. The old `typecheck` name would not be found by turbo.

**7. Convert `set NODE_ENV=xxx&&` to `cross-env`:**

The following scripts use Windows-specific `set` syntax that will NOT work on Linux/macOS or in Git Bash:

```diff
- "dev": "set NODE_ENV=development&& nest start api --watch -c infra/nest/dev.json",
+ "dev": "cross-env NODE_ENV=development nest start api --watch -c infra/nest/dev.json",
```

```diff
- "build": "set NODE_ENV=production&& nest build -c infra/nest/prod.json",
+ "build": "cross-env NODE_ENV=production nest build -c infra/nest/prod.json",
```

```diff
- "build:stage": "set NODE_ENV=stage&& nest build -c infra/nest/stage.json",
+ "build:stage": "cross-env NODE_ENV=stage nest build -c infra/nest/stage.json",
```

```diff
- "start:prod": "NODE_ENV=production node dist/walnut/admin/com/app/main.js",
+ "start:prod": "cross-env NODE_ENV=production node dist/walnut/admin/com/app/main.js",
```

```diff
- "start:stage": "NODE_ENV=stage node dist/walnut/admin/com/app/main.js",
+ "start:stage": "cross-env NODE_ENV=stage node dist/walnut/admin/com/app/main.js",
```

**Why:** `set NODE_ENV=xxx&&` (without a space before `&&`) is Windows CMD syntax. `${NAME}=value command` (without `set` and `&&`) is POSIX shell syntax. `cross-env` handles both, making the scripts cross-platform. This is critical for developer portability and CI environments.

Note: `start:prod` and `start:stage` originally used `NODE_ENV=production` (Unix-style) without `set`, which would fail on Windows. Converting them to `cross-env` fixes that too.

**8. Remove workspace-level metadata fields:**
```diff
- "config": { "domain": "walnut-admin.com" },
- "homepage": "https://github.com/walnut-admin",
- "repository": { ... },
- "bugs": { ... },
- "simple-git-hooks": { ... },
- "lint-staged": { ... },
```
**Why:** These are project-repository-level metadata. The monorepo root handles `simple-git-hooks` and `lint-staged`. The homepage/repo/bugs fields are redundant now that this is part of the root repository. Removal is optional but keeps `package.json` cleaner.

**9. Add `cross-env` to devDependencies:**
```diff
+ "cross-env": "^7.0.3",
```
**Why:** Needed by the scripts changed above. Must be added to the package's own `devDependencies` so pnpm resolves it.

**10. Add missing turbo stubs:**
```diff
+ "preview": "echo preview-not-configured",
+ "clean": "echo clean-not-configured",
```
**Why:** Turbo may run `preview` or `clean` tasks across all packages if the root turbo.json defines them. Adding stubs prevents failures. (Check root turbo.json to confirm whether these tasks exist; if not, these can be omitted.)

### Checklist

- [x] Name changed from `"walnut-admin-nestjs"` to `"@walnut/server"`
- [x] `"private": true` preserved
- [x] `"packageManager": "pnpm@10.33.0"` removed
- [x] `"engines": { "npm": "..." }` removed, only `"node": ">=24.13.0"` remains
- [x] `"preinstall"` script removed (root handles this)
- [x] `"typecheck"` renamed to `"types:check"`
- [x] All `set NODE_ENV=xxx&&` converted to `cross-env`
- [x] `"cross-env": "^7.0.3"` added to devDependencies
- [x] Optional metadata fields cleaned up
- [x] Turbo-required stub scripts present (`preview`, `clean`)

---

## 4b: SWC Path Verification

**Context:** The server uses SWC (via `@swc/cli` and `unplugin-swc`) as its TypeScript compiler. The SWC configuration files are at `infra/swc/` with path aliases that reference the NestJS monorepo's internal libraries.

### SWC config files

| File | Path |
|------|------|
| dev | `apps/server/infra/swc/dev.swcrc` |
| stage | `apps/server/infra/swc/stage.swcrc` |
| prod | `apps/server/infra/swc/prod.swcrc` |

### All three configs have:

```json
"jsc": {
  "baseUrl": ".",
  "paths": {
    "@/*": ["apps/api/src/*"],
    "@walnut/config": ["libs/config/src"],
    "@walnut/config/*": ["libs/config/src/*"],
    "@walnut/const": ["libs/const/src"],
    ...
  }
}
```

### The critical question

**Does SWC resolve `baseUrl` relative to CWD or relative to the swcrc file location?**

- **SWC's behavior:** `baseUrl` in SWC is resolved relative to the **current working directory (CWD)** at the time SWC runs, NOT relative to the swcrc file location. This is the same behavior as TypeScript's `tsconfig.json` `baseUrl`.

- **How NestJS runs SWC:** The NestJS CLI runs `nest build` from the project root. In our case, NestJS is configured via `infra/nest/dev.json` which points to the `tsconfig.build.json` and SWC config. NestJS sets CWD to the package root (`apps/server/`).

- **The implication:** Since `baseUrl: "."` is relative to CWD, and NestJS/CWD is `apps/server/`, the path `.` resolves to `apps/server/`. The paths like `"libs/config/src"` would then resolve to `apps/server/libs/config/src/`. This is **correct**.

### Verification step

```bash
# Position yourself in the server directory
cd apps/server

# Install dependencies (must have run pnpm install at root first)
pnpm install

# Try to start the dev server
pnpm dev
```

**Expected behavior:** The server starts without import errors. SWC resolves `@walnut/config` to `apps/server/libs/config/src` correctly.

**If `baseUrl` resolves to the monorepo ROOT instead of `apps/server/`** (e.g., if you see `"Cannot find module '@walnut/config'"` errors with the path resolving to `D:/walnut/walnut-admin/libs/config/src` instead of `D:/walnut/walnut-admin/apps/server/libs/config/src`):

### Fix: Update all 3 swcrc files

Change `"baseUrl": "."` to `"baseUrl": "../.."` in each file. The `--c` flag for `nest build` passes the NestJS config file path, and the NestJS config points to the swcrc file.

However, a more practical approach if the CWD is `apps/server/` and paths resolve correctly, **no change is needed**. Only apply this fix if you see import resolution failures.

### Files to modify (if broken)

| File | Line to change |
|------|---------------|
| `apps/server/infra/swc/dev.swcrc` | `"baseUrl": "."` → `"baseUrl": "../.."` |
| `apps/server/infra/swc/stage.swcrc` | `"baseUrl": "."` → `"baseUrl": "../.."` |
| `apps/server/infra/swc/prod.swcrc` | `"baseUrl": "."` → `"baseUrl": "../.."` |

**Why `"../.."`:** If SWC resolves relative to the swcrc file directory (`apps/server/infra/swc/`), then `".."` goes to `apps/server/infra/`, and `"../.."` goes to `apps/server/` which is the desired root for path resolution. But again, SWC resolves relative to CWD, so this should not be needed.

### Recommended action

1. Try `pnpm dev` from `apps/server/` first
2. If it works, leave the swcrc files unchanged
3. If you get import errors, apply the `baseUrl` fix above

---

## 4c: Config Module `projectRoot`

**File:** `apps/server/libs/config/src/config.module.ts`

### Current code

```typescript
const rawEnv = process.env.NODE_ENV
const env = rawEnv ?? 'development'
const projectRoot = process.cwd()
const envDir = isDev ? 'env-local' : 'env'
const envFilePath = join(projectRoot, envDir, `.env.${env}`)
```

### Analysis

The `projectRoot` is set to `process.cwd()`. This is important because:

1. When you run `pnpm dev` from within `apps/server/`, `process.cwd()` will be `apps/server/`.
2. The env file path will be `apps/server/env-local/.env.development`.

**This is the correct behavior** as long as the developer runs commands from `apps/server/`.

### The problem

When running via turbo from the monorepo root:

```bash
pnpm dev:server   # turbo dev --filter=@walnut/server
```

Turbo spawns the dev command from the **package's working directory**, which is `apps/server/`. So `process.cwd()` should still be `apps/server/`.

**But:** If someone configures a custom CWD or if turbo behavior changes, this could break.

### Possible fix approaches

**If `process.cwd()` unexpectedly points to the monorepo root:**

**Option A: Use `__dirname` instead of `process.cwd()` (most robust)**
```typescript
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = join(__dirname, '..', '..', '..', '..', '..')  // goes up from libs/config/src/ to apps/server/
```
This resolves relative to the file location, not CWD. However, it's fragile because the path depth depends on the source tree structure.

**Option B: Accept the default and add a warning**
Add a check that logs the resolved `projectRoot` on startup so developers can verify it's correct:
```typescript
console.log(`[Config] projectRoot resolved to: ${projectRoot}`)
console.log(`[Config] Loading env file: ${envFilePath}`)
```

**Option C: Make it configurable via environment variable**
```typescript
const projectRoot = process.env.WALNUT_PROJECT_ROOT ?? process.cwd()
```
This allows overriding if needed.

### Recommendation

**No change is needed** if the server starts correctly. The `process.cwd()` approach works because:
- `pnpm --filter` and `turbo --filter` both run commands from the package directory
- Developers running `cd apps/server && pnpm dev` will also get the correct CWD

If you encounter "env file not found" errors, try Option B first (add logging) to diagnose the actual CWD, then apply Option C if needed.

### Checklist

- [ ] Verified `process.cwd()` resolves to `apps/server/` during development
- [ ] Verified turbo runs from package directory (test with `pnpm dev:server`)
- [ ] If env file not found, add diagnostic logging or implement Option C
