# Step 7: Clean Install & Full Verification

> **Phase**: Phase 1 — Monorepo Setup
> **Goal**: Verify that the monorepo structure compiles, lints, and runs correctly after merging three repositories

---

## Step 7a: Clean Everything

Remove all `node_modules` directories and the lockfile to ensure a completely fresh install from the new `pnpm-workspace.yaml`.

> **Why**: After merging three repos, old `node_modules` directories may have conflicting dependency versions or platform-specific binaries. A clean install guarantees the lockfile represents a consistent, reproducible dependency graph.

```bash
# Remove all node_modules recursively
rm -rf node_modules/
rm -rf apps/admin/node_modules/
rm -rf apps/server/node_modules/
rm -rf apps/docs/node_modules/
rm -rf packages/*/node_modules/
rm -rf build/node_modules/

# Remove lockfile — forces full resolution from scratch
rm -f pnpm-lock.yaml
```

> **Why each directory**:
> - `node_modules/` — root-level hoisted dependencies
> - `apps/admin/node_modules/` — Vue admin app (previously the entire repo)
> - `apps/server/node_modules/` — NestJS backend
> - `apps/docs/node_modules/` — VitePress documentation site
> - `packages/*/node_modules/` — each shared workspace package
> - `build/node_modules/` — build scripts
> - `pnpm-lock.yaml` — stale lockfile with old resolutions

---

## Step 7b: Fresh Install

```bash
pnpm install
```

> **Why**: This runs a full dependency resolution using the current `pnpm-workspace.yaml`, generating a brand-new lockfile that reflects the merged dependency graph.

### Expected Issues and How to Handle Them

#### Issue 1: Peer Dependency Warnings

```
WARN deprecated some-package@1.0.0
WARN [33m WARN  Some dependencies have peer dependency mismatches[39m
WARN [33m WARN  ╭──────────────────────────────────────────────────────────╮[39m
WARN [33m WARN  │                                                          │[39m
WARN [33m WARN  │  peer vue@^3.4.0 wanted by eslint-plugin-vue@9.x         │
WARN [33m WARN  │  peer eslint@^8.0.0 wanted by @typescript-eslint/...     │
WARN [33m WARN  │                                                          │[39m
WARN [33m WARN  ╰──────────────────────────────────────────────────────────╯[39m
```

**Action**: Peer dependency warnings are non-fatal. Document them in the Known Issues doc (`09-known-issues.md`) but do not block the install. They typically indicate version mismatches across packages that can be harmonized in Phase 2.

#### Issue 2: `allowBuilds` Errors

pnpm 11 requires explicit opt-in for packages that run build scripts (install scripts).

```
pnpm: No packages that run build scripts have been allowed
       │ Allow build scripts with the `pnpm.onlyBuiltDependencies` field in package.json,
       │ or the `onlyBuiltDependencies` field in pnpm-workspace.yaml.

       This project contains packages that need to run build scripts:
       * esbuild
       * swc
       * sharp
       * node-gyp (via some native addon)
```

**Action**: Add each reported package to `pnpm-workspace.yaml` under the `onlyBuiltDependencies` array:

```yaml
# pnpm-workspace.yaml
onlyBuiltDependencies:
  - esbuild
  - swc
  - sharp
```

Then re-run `pnpm install`. Repeat until all build errors are resolved.

> **Note**: The correct field in pnpm 7-10 was `pnpm.onlyBuiltDependencies` in `package.json` OR `onlyBuiltDependencies` in `pnpm-workspace.yaml`. In pnpm 11, workspace-level config is preferred.

#### Issue 3: Engine Mismatch

```
ERR_PNPM_UNSATISFIED_ENGINE  Unsupported engine

  Package: some-package@1.0.0
  Expected: node@>=20.0.0
  Found: node@18.19.0

  For a full description see ...
```

**Action**: Stop immediately. The project requires Node >=20.0.0. Verify your Node version:

```bash
node --version   # Must be >=20.0.0
pnpm --version   # Must be >=8.0.0
```

If Node is too old, use `nvm` or `fnm` to upgrade. If pnpm is too old, run:

```bash
corepack enable
corepack prepare pnpm@latest-11 --activate   # for pnpm 11
```

> **Why**: The monorepo uses workspace features and package scripts that require modern Node.js (named imports of `process`, native `fetch`, etc.).

#### Issue 4: Workspace Package Not Found

```
ERR_PNPM_NO_MATCHING_VERSION_SPEC  No matching version found for @walnut/server@*

  An error occurred while resolving dependency:
  @walnut/server@*
  The latest release of @walnut/server is 0.0.0, but * is required.
  No workspace match found.
```

**Action**: This means pnpm cannot find a workspace package matching the reference. Check:

1. **Package name in `apps/server/package.json`**: The `name` field must match what other packages reference:

   ```bash
   cat apps/server/package.json | grep '"name"'
   ```

   Expected output: `"name": "@walnut/server"`.

2. **Workspace glob in `pnpm-workspace.yaml`**: Ensure the glob covers the `apps/server` directory:

   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
     - "build"
   ```

   If `apps/*` is present, `apps/server` is included.

3. **Build the package first**: Some packages are referenced as workspace dependencies but the consuming package expects them to be built. For pure-TypeScript packages, this usually works via `"workspace:*"` protocol. For compiled packages, the workspace package may need a build step before the consuming package can import it.

---

## Step 7c: Verification Checklist

Each verification below provides an exact command, expected output, and remediation steps.

### 1. Install Success

```bash
pnpm install
```

- **Expected output**: Clean exit code 0. No `ERR_PNPM_*` messages. Final line shows `Done in X.Xs`.
- **If it fails**: See Step 7b above for known issues and fixes.

### 2. TypeScript Check

```bash
pnpm types:check
```

- **Expected output**: All packages pass `vue-tsc --noEmit` and `tsc --noEmit` without errors.

- **Known initial errors** (Phase 1 only — may exist and be acceptable):

  | Error Pattern | Likely Cause | Action |
  |---|---|---|
  | `Cannot find module '@walnut/shared'` | Path alias not resolved across workspace | Check `tsconfig.json` paths and `references` field |
  | `Type 'X' is not assignable to type 'Y'` | Upgraded dependency types | May be pre-existing; document but don't fix in Phase 1 |
  | `Property 'xxx' does not exist on type 'yyy'` | Missing declarations | May require package.json `types` or `exports` mapping |
  | `has no exported member 'xxx'` | Package index.ts doesn't re-export | Add the export to the package's `src/index.ts` |

- **If it fails with >50 errors**: Likely a fundamental path resolution issue. Run a targeted check on admin alone first:
  ```bash
  cd apps/admin && npx vue-tsc --noEmit
  ```
  If admin alone passes, the issue is in the `references` config or type acquisition for workspace packages.

### 3. Lint

```bash
pnpm lint
```

- **Expected output**: All packages pass ESLint. Warnings are acceptable but errors are not.

- **Known concerns**:
  - Server uses `@antfu/eslint-config@8.0.0` with ESLint 10.x
  - Docs uses `@antfu/eslint-config@4.16.2` (very old) with ESLint 9.x
  - Admin uses `@antfu/eslint-config@8.2.0` with ESLint 10.x
  - Different versions may produce different results on the same code patterns.

- **If it fails**: Run lint for each app individually to isolate the issue:
  ```bash
  pnpm --filter @walnut/admin lint
  pnpm --filter @walnut/server lint
  pnpm --filter @walnut/docs lint
  ```

- **Temporary workaround**: If docs' old eslint setup blocks the root lint, you can exclude it from the root lint until it's upgraded in Phase 2:
  ```bash
  # Run lint on admin + server only
  pnpm --filter @walnut/admin lint && pnpm --filter @walnut/server lint
  ```

### 4. Admin Dev Server

```bash
pnpm dev:admin
```

- **Expected output**: Vite dev server starts on `http://127.0.0.1:3100`. Terminal shows:
  ```
  VITE v6.x.x  ready in XXXX ms
  ➜  Local:   http://127.0.0.1:3100/
  ➜  Network: http://192.168.x.x:3100/
  ```

- **If it fails**:
  - `Cannot find module '@walnut/shared'`: Check that packages/shared builds first. Run `pnpm --filter @walnut/shared build`.
  - Auto-import errors: The admin app uses `unplugin-auto-import` which may need updated path resolutions after the move.
  - HMR issues: The `apps/admin/` directory structure changed. If Vite's cache is stale, delete `node_modules/.vite` and restart.

- **If it starts but is slow**: This is normal for the first startup. Vite caches dependencies on first load.

### 5. Server Dev Server

```bash
pnpm dev:server
```

- **Expected output**: NestJS starts in watch mode on port 3000 (or configured port):
  ```
  [Nest] XXXXXX  - LOG [NestFactory] Starting NestJS application...
  [Nest] XXXXXX  - LOG [InstanceLoader] AppModule dependencies initialized
  [Nest] XXXXXX  - LOG [NestApplication] Nest application successfully started
  ```

- **Prerequisites**: MongoDB and Redis must be running. Check if docker-compose files exist:
  ```bash
  ls apps/server/docker-compose*.yml 2>/dev/null || echo "No docker-compose found"
  ls apps/server/docker-compose*.yaml 2>/dev/null || echo "No docker-compose found"
  ```

- **If docker-compose exists**:
  ```bash
  cd apps/server && docker-compose up -d mongo redis
  ```

- **If no docker-compose**: You need standalone MongoDB and Redis instances. Set connection strings via environment variables:
  ```bash
  MONGODB_URI=mongodb://localhost:27017/walnut  pnpm dev:server
  ```

- **If it fails to start**:
  - `EnvConfigError: projectRoot not found`: See Issue 5 in `09-known-issues.md`. The `ConfigModule` in `libs/config` may compute the wrong root. Adjust `projectRoot` relative to the new monorepo path.
  - `Can't resolve graphql`: NestJS GraphQL plugin may need a schema-first configuration update.
  - SWC compilation errors: Check `.swcrc` paths — the `baseUrl` may need changing from `"."` to `"../.."`.

### 6. Docs Dev Server

```bash
pnpm dev:docs
```

- **Expected output**: VitePress starts on default port 5173 (or as configured):
  ```
  vitepress v1.x.x
  ➜  Local:   http://localhost:5173/
  ➜  Network: http://192.168.x.x:5173/
  ```

- **If it fails**:
  - Upgrade Vitepress: Docs may have been using an older VitePress version. Check `apps/docs/package.json` and upgrade if needed.
  - Ensure `vitepress` is in dependencies, not devDependencies (VitePress often requires it in regular deps for `vitepress build`).

- **Configuration check**: Verify `apps/docs/.vitepress/config.ts` exists and has valid paths:
  ```bash
  ls apps/docs/.vitepress/config.*
  ```

### 7. Admin Build

```bash
pnpm build:admin
```

- **Expected output**: Vite builds the admin app to the output directory. Final output shows:
  ```
  ✓ built in X.XXs
  ```

- **If it fails**:
  - Check that `VITE_BUILD_OUT_DIR` is set correctly in the environment or `.env` file.
  - Check for bundle warnings about large chunks (not fatal, but note them).

### 8. Server Build

```bash
pnpm build:server
```

- **Expected output**: NestJS compiles TypeScript to JavaScript. Output shows:
  ```
  Successfully compiled: X modules
  ```

- **If it fails**:
  - SWC path errors: See Phase 1 Server adaptation guide.
  - NestJS not found: Ensure `@nestjs/cli` is in server's `devDependencies`.

### 9. Docs Build

```bash
pnpm build:docs
```

- **Expected output**: VitePress builds static HTML:
  ```
  ✓ built in X.XXs
  ```

- **If it fails**: Check for outdated VitePress plugins or configuration.

### 10. Full Build

```bash
pnpm build
```

- **Expected output**: Turborepo runs all builds in order (respecting dependency graph):
  ```
  • Packages in scope: @walnut/server, @walnut/admin, @walnut/docs, ...
  • Running tasks: build
  Tasks:    1 successful, 1 total
  ```

- **If it fails**: Run builds individually to isolate the failing package.

---

## Step 7d: Known Issues to Expect

### Server SWC Paths
- **Issue**: The NestJS SWC builder may fail if `baseUrl` in `.swcrc` doesn't account for the monorepo nesting.
- **Check**: `apps/server/.swcrc` — the `baseUrl` is likely `"."` (old project root). It may need to be `"../.."` depending on how NestJS resolves paths.
- **Fix**: See `04-server-adapt.md` for detailed instructions.

### Server ConfigModule `projectRoot`
- **Issue**: The custom `ConfigModule` in `libs/config` computes the project root directory to find `env-local/`. After moving to `apps/server/`, this computation may return the monorepo root instead of `apps/server/`.
- **Check**: When `pnpm dev:server` fails with "env-local not found", this is the likely cause.
- **Fix**: Locate `projectRoot` calculation in the config service and adjust it relative to the new location.

### Docs ESLint Compatibility with Node 24
- **Issue**: The docs package uses `@antfu/eslint-config@4.16.2`, which is a very old version that may not be compatible with Node 24.
- **Symptom**: `pnpm lint` or `pnpm lint:docs` fails with cryptic ESLint parser errors.
- **Fix**: Upgrade the docs eslint config in Phase 2, or pin Node version.

### Fresh Lockfile Differences
- **Issue**: The new `pnpm-lock.yaml` will resolve dependency versions differently than the three separate lockfiles from the old repos. This can introduce behavioral changes in dependencies.
- **Action**: Document any significant version bumps, but don't fix them unless they cause build failures.

### `build` Workspace Package
- **Issue**: The `build/` directory was added as a workspace package (referenced in `pnpm-workspace.yaml`). If its `package.json` is incomplete (missing `name`, version, or exports), pnpm may fail to resolve it.
- **Check**: `build/package.json` must have `"name"`.
- **Fix**: Add a proper `package.json` or remove `build` from the workspace packages list if it's not meant to be a workspace package.

---

## Step 7e: Troubleshooting Section

| Symptom | Likely Cause | Solution |
|---|---|---|
| `Cannot find module '@walnut/xxx'` | Workspace package name mismatch or missing build step | Verify `package.json` `name` field. Run `pnpm --filter @walnut/xxx build`. |
| `nest: command not found` | `@nestjs/cli` not installed | Add `@nestjs/cli` to `apps/server/package.json` `devDependencies`. |
| `SWC compilation failed` | `.swcrc` paths still point to old locations | Check `baseUrl`, `paths`, and `rootDir` in `.swcrc`. |
| `ERR_PNPM_NO_MATCHING_VERSION_SPEC` | Workspace package glob not matching, or package name wrong | Verify `pnpm-workspace.yaml` glob patterns cover all apps/ and packages/ subdirectories. |
| `esbuild not found` during build | Missing allowBuilds entry | Add `esbuild` to `onlyBuiltDependencies` in `pnpm-workspace.yaml`. |
| `sharp` build failure | Native addon needs build tools | Install build-essential (Linux) or check C++ build tools (Windows). |
| `TypeScript errors in packages/` | Pre-existing type issues or new resolution issues | Check if the error existed before the monorepo merge. If it did, document and defer to Phase 2. |
| `process.env.XXX is undefined` | Environment variables not loaded correctly | Check that `env-local/` files exist and are being read by the correct ConfigModule. |
| `dev:admin starts server/docs too` | Monorepo `dev` script uses `turbo dev` which detects all persistent tasks | Use `pnpm dev:admin` (with `--filter`) instead of `pnpm dev`. |
| `pnpm: command not found` | pnpm not in PATH after fresh setup | Run `corepack enable && corepack prepare pnpm@latest-11 --activate`. |
| `pnpm-lock.yaml` merge conflicts | Different lockfile format from old repos | Delete lockfile and re-run `pnpm install` (Step 7a + 7b). |
| `vue-tsc: not found` | TypeScript check tool not installed globally | It's in root `devDependencies`. Run `pnpm install` first, then use `pnpm types:check`. |
| Windows EOL issues (`\r\n`) | Scripts have `\r\n` line endings | Configure git to handle line endings: `git config core.autocrlf input`. Re-checkout files. |
| `env-local/` files missing | Directory was gitignored | Create from `.env.development` template or check if they were in `.gitignore`. |

---

## Verification Sign-Off

Before proceeding to Phase 2, confirm:

- [ ] `pnpm install` completes without errors
- [ ] All 3 apps can start in dev mode (admin, server, docs)
- [ ] Admin builds successfully
- [ ] Server builds successfully (if SWC/config is resolved)
- [ ] Docs builds successfully
- [ ] Known issues are documented in `09-known-issues.md`
- [ ] Phase 1 is complete and the monorepo is functional

---

> **Next**: [08-phase2-packages.md](./08-phase2-packages.md) — Redesigning the packages/ directory for reusability
