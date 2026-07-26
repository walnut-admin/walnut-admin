# Step 3: Root Monorepo Configuration

This step updates the root-level monorepo configuration files to accommodate the new server and docs packages, and upgrades pnpm from 9.x to 11.x.

---

## 3a: Update `package.json`

**File:** `D:/walnut/walnut-admin/package.json`

### Changes

| Field | Before | After | Why |
|-------|--------|-------|-----|
| `name` | `"walnut-monorepo"` | `"walnut-admin"` | The monorepo represents the entire walnut-admin ecosystem, not just the admin frontend. A cleaner name for the root package. |
| `engines.node` | `>=20.0.0` | `>=24.13.0` | The server requires Node 24.13+ (it already specified this), and the monorepo should match the highest requirement across all packages. |
| `engines.pnpm` | `>=9.0.0` | `>=11.0.0` | pnpm 11 is required for hoisting config support in pnpm-workspace.yaml. |
| `packageManager` | `pnpm@9.15.0` | `pnpm@11.13.0` | Upgrade the pinned package manager to pnpm 11.13.0 (latest stable in the 11.x line). |

### Before (current state)

```json
{
  "name": "walnut-monorepo",
  "private": true,
  "type": "module",
  "description": "Walnut Admin Monorepo",
  "author": { ... },
  "license": "MIT",
  "engines": {
    "node": ">=20.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "preinstall": "npx only-allow pnpm",
    "postinstall": "npx simple-git-hooks",
    "dev": "turbo dev",
    "dev:admin": "turbo dev --filter=@walnut/admin",
    "build": "NODE_OPTIONS=--max-old-space-size=8192 turbo build",
    "build:admin": "NODE_OPTIONS=--max-old-space-size=8192 turbo build --filter=@walnut/admin",
    "build:stage": "NODE_OPTIONS=--max-old-space-size=8192 turbo build --filter=@walnut/admin -- -- --mode staging",
    "preview": "turbo preview",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "types:check": "turbo types:check",
    "clean": "turbo clean",
    "clean:all": "rimraf node_modules apps/*/node_modules packages/*/node_modules build/node_modules",
    "check:deps:update": "npx taze major -l",
    "commit:msg": "commitlint --edit",
    "changelog": "tsx apps/admin/scripts/release/changelog.ts",
    "git:push": "tsx apps/admin/scripts/release/git.ts",
    "deploy:stage": "deploy-cli-service deploy --mode staging",
    "deploy:prod": "deploy-cli-service deploy --mode production",
    "generate-pwa-assets": "pwa-assets-generator"
  },
  "devDependencies": { ... },
  "simple-git-hooks": { ... },
  "lint-staged": { ... },
  "packageManager": "pnpm@9.15.0",
  "pnpm": {
    "peerDependencyRules": {
      "allowAny": [
        "vite"
      ]
    }
  }
}
```

### After (new state)

```json
{
  "name": "walnut-admin",
  "private": true,
  "type": "module",
  "description": "Walnut Admin Monorepo",
  "author": {
    "name": "Zhaocl1997",
    "email": "zhaocl97@foxmail.com",
    "url": "https://github.com/Zhaocl1997"
  },
  "license": "MIT",
  "engines": {
    "node": ">=24.13.0",
    "pnpm": ">=11.0.0"
  },
  "scripts": {
    "preinstall": "npx only-allow pnpm",
    "postinstall": "npx simple-git-hooks",
    "dev": "turbo dev",
    "dev:admin": "turbo dev --filter=@walnut/admin",
    "dev:server": "turbo dev --filter=@walnut/server",
    "dev:docs": "turbo dev --filter=@walnut/docs",
    "build": "NODE_OPTIONS=--max-old-space-size=8192 turbo build",
    "build:admin": "NODE_OPTIONS=--max-old-space-size=8192 turbo build --filter=@walnut/admin",
    "build:server": "turbo build --filter=@walnut/server",
    "build:docs": "turbo build --filter=@walnut/docs",
    "build:stage": "NODE_OPTIONS=--max-old-space-size=8192 turbo build --filter=@walnut/admin -- -- --mode staging",
    "preview": "turbo preview",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "types:check": "turbo types:check",
    "clean": "turbo clean",
    "clean:all": "rimraf node_modules apps/*/node_modules packages/*/node_modules",
    "check:deps:update": "npx taze major -l",
    "commit:msg": "commitlint --edit",
    "changelog": "tsx apps/admin/scripts/release/changelog.ts",
    "git:push": "tsx apps/admin/scripts/release/git.ts",
    "deploy:stage": "deploy-cli-service deploy --mode staging",
    "deploy:prod": "deploy-cli-service deploy --mode production",
    "generate-pwa-assets": "pwa-assets-generator"
  },
  "devDependencies": {
    "@antfu/eslint-config": "8.2.0",
    "@commitlint/cli": "20.5.3",
    "@commitlint/config-conventional": "20.5.3",
    "eslint": "10.3.0",
    "lint-staged": "17.0.2",
    "rimraf": "6.1.3",
    "simple-git-hooks": "2.13.1",
    "taze": "19.11.0",
    "turbo": "2.4.0",
    "typescript": "6.0.3"
  },
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged",
    "pre-push": "pnpm types:check"
  },
  "lint-staged": {
    "*.{ts,vue}": "eslint --fix --concurrency=auto"
  },
  "packageManager": "pnpm@11.13.0"
}
```

### Specific diffs explained

**1. Name change:**
```diff
- "name": "walnut-monorepo",
+ "name": "walnut-admin",
```

**2. Engines bump:**
```diff
- "engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }
+ "engines": { "node": ">=24.13.0", "pnpm": ">=11.0.0" }
```

**3. New scripts added after existing `dev:admin`:**
```diff
+   "dev:server": "turbo dev --filter=@walnut/server",
+   "dev:docs": "turbo dev --filter=@walnut/docs",
```
These allow targeting server and docs individually (same pattern as `dev:admin`).

**4. New build scripts:**
```diff
+   "build:server": "turbo build --filter=@walnut/server",
+   "build:docs": "turbo build --filter=@walnut/docs",
```
Note: `build:server` does NOT use `NODE_OPTIONS=--max-old-space-size=8192` because the NestJS build is lighter than the Vite frontend build. `build:docs` also does not need it.

**5. `clean:all` removal of `build/node_modules`:**
```diff
- "clean:all": "rimraf node_modules apps/*/node_modules packages/*/node_modules build/node_modules",
+ "clean:all": "rimraf node_modules apps/*/node_modules packages/*/node_modules",
```
The `build/` directory no longer exists as a workspace package (see 3f below), so its node_modules reference is removed.

**6. PackageManager upgrade:**
```diff
- "packageManager": "pnpm@9.15.0",
+ "packageManager": "pnpm@11.13.0",
```

**7. Entire `"pnpm"` block REMOVED:**
```diff
- "pnpm": {
-   "peerDependencyRules": {
-     "allowAny": ["vite"]
-   }
- }
```
**Why removed:** pnpm 11 moves package-specific configuration like `peerDependencyRules` out of `package.json` and into `pnpm-workspace.yaml` under the `packageConfigs` section. Keeping it in `package.json` would cause a warning or be silently ignored. See 3b below for the migrated config.

---

## 3b: Update `pnpm-workspace.yaml`

**File:** `D:/walnut/walnut-admin/pnpm-workspace.yaml`

### Current content

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - build
```

### New content

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - build

# pnpm 11: migrated from package.json#pnpm
packageConfigs:
  peerDependencyRules:
    allowAny:
      - vite

# pnpm 11: migrated from .npmrc shamefully-hoist=true
hoisting: true

# pnpm 11: build allowlist (add entries as pnpm install reports them)
allowBuilds: {}
```

### What each section does

| Section | Purpose |
|---------|---------|
| `packages` | Defines which directories are workspace packages (unchanged). |
| `packageConfigs.peerDependencyRules.allowAny` | This is the pnpm 11 way to allow certain peer dependencies without warning. Previously this lived in `package.json` under `"pnpm": { "peerDependencyRules": { "allowAny": ["vite"] } }`. In pnpm 11, this config must live in `pnpm-workspace.yaml` under `packageConfigs`. Without this, `pnpm install` would warn about each `vite` peer dependency not being satisfied explicitly. |
| `hoisting: true` | This is the pnpm 11 equivalent of `.npmrc`'s `shamefully-hoist=true`. It hoists all dependencies to the root `node_modules` so packages can resolve them without explicit declarations. This is important for the server package which may rely on hoisted dev dependencies like `@nestjs/cli`. |
| `allowBuilds: {}` | pnpm 11 requires explicit opt-in for packages that run `postinstall` scripts (like `esbuild`, `native-addon` modules). Start with an empty object and add entries as `pnpm install` fails with a message like "package X has been blocked from running postinstall scripts". Example entries: `esbuild: true`, `simple-git-hooks: true`. |

---

## 3c: Update `.npmrc`

**File:** `D:/walnut/walnut-admin/.npmrc`

### Current content

```ini
strict-peer-dependencies=true
engine-strict=true
save-exact=true
shamefully-hoist=true
```

### New content

```ini
strict-peer-dependencies=true
engine-strict=true
save-exact=true
```

### What changed

```diff
- shamefully-hoist=true
```

**Why removed:** In pnpm 11, hoisting behavior is configured in `pnpm-workspace.yaml` via the `hoisting` key (set to `true`). The `.npmrc` `shamefully-hoist` flag is deprecated in pnpm 11 and may produce warnings. The `.npmrc` file should ideally only contain registry/auth configuration and simple boolean flags. pnpm-specific structural configuration belongs in `pnpm-workspace.yaml`.

The remaining three lines are kept:

| Setting | Purpose |
|---------|---------|
| `strict-peer-dependencies=true` | Fail on unmet peer deps during install (catches missing deps early). |
| `engine-strict=true` | Fail install if Node.js version does not satisfy `engines.node`. |
| `save-exact=true` | Save exact versions (no `^` / `~` range prefixes) when running `pnpm add`. Ensures reproducible builds. |

---

## 3d: Update `.gitignore`

**File:** `D:/walnut/walnut-admin/.gitignore`

### Current content

```
node_modules
.DS_Store
*.local
*.zip
release-notes.md

# Turborepo
.turbo

# Build outputs
dist/
dist-*/
dev-dist/

# TypeScript
*.tsbuildinfo

# Auto-generated
types/auto-import.d.ts
types/components.d.ts

# Build generated
build/_generated/*.ts
build/_generated/*.json
build/_generated/*.log

# Environment
env-local/

# Deploy configs (may contain credentials)
deploy.config.*

# Reports (keep .md files)
report/*
!report/*.md

# Legacy
config/husky/*
```

### New content

```
node_modules
.DS_Store
*.local
*.zip
release-notes.md

# Turborepo
.turbo

# Build outputs
dist/
dist-*/
dev-dist/

# TypeScript
*.tsbuildinfo

# Auto-generated
types/auto-import.d.ts
types/components.d.ts

# Build generated
build/_generated/*.ts
build/_generated/*.json
build/_generated/*.log

# Environment
env-local/

# Deploy configs (may contain credentials)
deploy.config.*

# Reports (keep .md files)
report/*
!report/*.md

# Legacy
config/husky/*

# server
apps/server/env-local/
apps/server/logs/
apps/server/dist/
```

### What changed

```diff
+ # server
+ apps/server/env-local/
+ apps/server/logs/
+ apps/server/dist/
```

These additions are needed because:

| Entry | Why |
|-------|-----|
| `apps/server/env-local/` | The server's local environment files (`.env.development` etc.) are in `env-local/` relative to the server package. Without this entry, they would be tracked by git. |
| `apps/server/logs/` | The NestJS server writes runtime logs to a `logs/` directory. These are generated artifacts. |
| `apps/server/dist/` | The NestJS build output directory. Turbo already caches this, but it should also be gitignored. |

**Note:** The existing root-level `env-local/` pattern already covers any `env-local/` folder at the root. However, the server's `env-local/` is nested one level deeper (`apps/server/env-local/`), so an explicit nested path is required. The glob pattern `env-local/` only matches top-level and immediate subdirectory patterns when not using `**/`.

---

## 3e: Remove mfa-demo placeholder

**Command:**

```bash
rm -rf apps/mfa-demo/
```

**Alternatively, if using PowerShell:**

```powershell
Remove-Item -Recurse -Force apps/mfa-demo/
```

**What it is:** The `apps/mfa-demo/` directory is an empty placeholder package that was scaffolded during the initial monorepo setup. Its `package.json` declares `"description": "MFA demo application - reserved for future use"` and has dependencies on `@walnut/ui` and `@walnut/shared`.

**Why remove it:**
1. It is an **unused placeholder** with no actual source code -- only a `package.json` and `node_modules/` from a past `pnpm install`.
2. Having a full workspace package with zero code adds unnecessary complexity to the workspace graph and may cause turbo to try to build it.
3. If/when an MFA demo app is actually created, it can be added back as a proper package at that point.
4. The mfa-demo imports `@walnut/ui` and `@walnut/shared` which themselves may not be ready or exist yet, potentially causing install/link errors.

---

## 3f: Handle the `build/` Directory

**Current state:** The `build/` directory is listed in `pnpm-workspace.yaml` as a workspace package, but it **does not exist** in the filesystem.

**What to do:** No action is needed for this step. The `build/` path is still listed in `pnpm-workspace.yaml` (kept for compatibility), and pnpm will simply ignore it if the directory doesn't exist. However, there are two possible scenarios:

### Scenario 1: `build/` does not exist (current state)

The `build/` entry in `pnpm-workspace.yaml` is harmless. pnpm silently skips non-existent directories when resolving workspace packages. The previous `clean:all` script referenced `build/node_modules` but since the directory never existed, that path was never cleaned (now removed anyway per 3a).

No further action required.

### Scenario 2: `build/` exists and is a workspace package

If the `build/` directory is later created (e.g., as a shared build-tooling package), it should have:

```json
// build/package.json
{
  "name": "@walnut/build",
  "private": true,
  "scripts": {
    "lint": "echo linted",
    "types:check": "echo skipped",
    "build": "echo built"
  }
}
```

These stub scripts allow turbo to track the package without failing on missing tasks.

---

## Verification after this step

Run these commands to verify all changes are correct:

```bash
# 1. Verify package.json changes
cat package.json

# Expected to see:
#   - "name": "walnut-admin"
#   - "engines": { "node": ">=24.13.0", "pnpm": ">=11.0.0" }
#   - "packageManager": "pnpm@11.13.0"
#   - New dev:server, dev:docs, build:server, build:docs scripts
#   - NO "pnpm" block at the bottom

# 2. Verify pnpm-workspace.yaml
cat pnpm-workspace.yaml

# Expected to see:
#   - packages list unchanged
#   - packageConfigs with peerDependencyRules
#   - hoisting: true
#   - allowBuilds: {}

# 3. Verify .npmrc
cat .npmrc

# Expected to see only 3 lines (shamefully-hoist removed):
#   strict-peer-dependencies=true
#   engine-strict=true
#   save-exact=true

# 4. Verify .gitignore
cat .gitignore

# Expected to see new server entries at the bottom

# 5. Verify mfa-demo is gone
ls apps/
# Expected: admin (and potentially server, docs after copying)
# NOT expected: mfa-demo
```
