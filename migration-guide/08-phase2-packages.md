# Phase 2: Redesigning the packages/ Directory

> **Phase**: Phase 2 — Package Decoupling
> **Goal**: Transform every workspace package into a non-business, project-agnostic library that could be published to npm and used in a completely different project without modification.

---

## The Current Problem

The 5 packages under `packages/` were created by **splitting the frontend app by module**, NOT by reusability. As a result, they are tightly coupled to the Walnut Admin business domain:

### `@walnut/shared`
```
packages/shared/src/
├── utils/           # Pure functions (deepClone, object path, queue, file utils) ← KEEP
│   └── crypto/      # AES-GCM, RSA-OAEP, HKDF, HMAC, signature derivation ← KEEP
│   └── regex.ts     # Phone, email, IP, URL patterns ← KEEP
│   └── persistent/  # localStorage, IndexedDB, Cookie wrappers ← KEEP
├── const/           # Menu names, tab names, business constants ← MOVE BACK to admin
└── index.ts         # Re-exports everything (pure + business together)
```

**Problem**: `const/` contains business-specific constants like menu identifiers and tab titles that are meaningless outside of this admin app.

### `@walnut/axios`
```
packages/axios/src/
├── core/            # HTTP client utilities (config, instance, cache, cancel, retry, throttle) ← KEEP
├── adapters/        # Request/response adapters ← KEEP
└── interceptors/    # Token injection, signature, encryption, fingerprint ← MOVE BACK to admin
```

**Problem**: The interceptors implement Walnut Admin's specific auth protocol (OPAQUE, RSA signature, device fingerprinting). These are business logic, not general-purpose HTTP utilities.

### `@walnut/core`
```
packages/core/src/
├── stores/          # Pinia stores (app, user, setting, component) ← MOVE BACK entirely
├── router/          # Vue Router configuration ← MOVE BACK entirely
├── composables/     # Vue composables ← MOVE BACK entirely
└── socket/          # WebSocket client ← MOVE BACK entirely
```

**Problem**: EVERYTHING in here is business-specific. Pinia stores reference app-specific auth flows, the router has the admin route tree, composables assume the admin UI structure. There is nothing to extract.

### `@walnut/ui`
```
packages/ui/src/components/
├── UI/              # WTable, WForm engines, framework-level components ← PARTIALLY KEEP
├── Extra/           # EmailInput, IconPicker, etc. ← KEEP
├── HOC/             # Higher-order components ← KEEP
├── Business/        # Dict, AvatarUpload ← MOVE BACK to admin
├── Advanced/        # WCRUD, ApiSelect, RoleSelect ← MOVE BACK to admin
└── App/             # App-level components ← MOVE BACK to admin
```

**Problem**: Mixes genuinely reusable framework-level components (WTable engine, WForm engine) with business components (Dict that fetches from app-specific API endpoints).

### `@walnut/ai`
```
packages/ai/src/
├── components/      # AI chat panel UI ← MOVE BACK to admin entirely
└── stores/          # AI-related Pinia stores ← MOVE BACK to admin entirely
```

**Problem**: Entirely business logic — an AI chat panel built for this admin app.

---

## Design Principle

> **Every package in `packages/` must be a non-business, project-agnostic library.**
>
> A package passes the "npm test": you should be able to publish it to npm and use it in a completely different project (a React dashboard, a Vue storefront, a CLI tool, a mobile app) without any modification.

### What Makes a Package Business-Agnostic?

| Criteria | Yes (library material) | No (keep in app) |
|---|---|---|
| **Pure logic** | deepClone, debounce, regex patterns | API token refresh logic |
| **Standard protocol** | AES-GCM encryption patterns | Walnut-specific auth handshake |
| **Framework layer** | Generic table engine (WTable) | Dict component that calls /api/dict |
| **Standard wrapper** | localStorage abstraction | App setting persistence format |
| **Type utility** | DeepKeyOf, UnionToIntersection | Business entity types |

---

## Target Directory Structure

After Phase 2, `packages/` should look like this:

```
packages/
├── types/      @walnut/types      — Utility TypeScript types (DeepKeyOf, ViteEnv, etc.)
├── util/       @walnut/util       — General utility functions (deepClone, object path, queue)
├── regex/      @walnut/regex      — Regex patterns (phone, email, IP, URL)
├── crypto/     @walnut/crypto     — Cryptographic primitives (AES-GCM, RSA-OAEP, HKDF, HMAC)
├── storage/    @walnut/storage    — Browser storage abstraction (localStorage, IndexedDB, Cookie)
├── http/       @walnut/http       — HTTP client utilities (instance, cache, cancel, retry, throttle, merge)
│                                   NOT business interceptors (token, sign, encrypt, fingerprint)
└── ui/         @walnut/ui         — Framework-level components (WTable, WForm, EmailInput, IconPicker, HOC)
                                    NOT Business/ or Advanced/ components
```

---

## What Goes Back to `apps/admin/src/`

| Current Location | Contents | New Location | Why |
|---|---|---|---|
| `packages/shared/src/const/` | Menu names, tab labels, business enums | `apps/admin/src/const/` | These constants are specific to the admin UI's navigation and feature set |
| `packages/shared/src/utils/shared.ts` | `slotText()`, `deviceDetect()`, browser detection | `apps/admin/src/utils/` | Device detection assumes browser context and admin-specific use cases |
| `packages/axios/src/interceptors/` | Token injection, OPAQUE signature, encryption, device fingerprint | `apps/admin/src/api/interceptors/` | Implements Walnut Admin's specific auth protocol |
| `packages/axios/src/interceptors/` | Request/response adapters for Walnut API format | `apps/admin/src/api/adapters/` | The API response envelope format is business-specific |
| `packages/core/` | ALL — Pinia stores, Router, composables, socket | `apps/admin/src/` | Everything in core is app-specific |
| `packages/core/src/stores/` | app, user, setting, component stores | `apps/admin/src/store/modules/` | Pinia stores are tightly coupled to app behavior |
| `packages/core/src/router/` | Route tree, guards, middleware | `apps/admin/src/router/` | Routes define the admin app structure |
| `packages/core/src/composables/` | useAuth, usePermission, etc. | `apps/admin/src/hooks/` | Composables use app-specific stores |
| `packages/core/src/socket/` | WebSocket client with business handlers | `apps/admin/src/socket/` | Socket handlers implement business logic |
| `packages/ui/src/components/Business/` | Dict, AvatarUpload, Business components | `apps/admin/src/components/Business/` | These call app-specific APIs |
| `packages/ui/src/components/Advanced/` | WCRUD, ApiSelect, RoleSelect | `apps/admin/src/components/Advanced/` | WCRUD is a CRUD engine tied to the admin data model |
| `packages/ai/` | ALL — chat panel, AI stores | `apps/admin/src/components/AI/` | The AI chat panel is part of the admin feature set |

---

## Target Package Specifications

### `@walnut/types`

**Purpose**: Reusable TypeScript type utilities for any TypeScript project.

**Source**: `types/custom.d.ts`, `types/global.d.ts`, `types/shims.d.ts`

**Scope**:
- `DeepKeyOf<T>` — Recursive keyof
- `UnionToIntersection<U>` — Union to intersection
- `Nullable<T>`, `MaybeRef<T>` — Utility wrappers
- `ViteEnv` — Vite environment type
- `AnyFunction`, `AnyClass` — General-purpose aliases

**NOT included**:
- Business entity types (`UserInfo`, `RoleVO`) — these stay in `apps/admin/`
- API response types (`Result`, `Page`) — these stay in `apps/admin/`

**Package skeleton**:
```json
{
  "name": "@walnut/types",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

> Note: Using `./src/index.ts` allows direct TypeScript consumption within the monorepo. If publishing to npm, swap to compiled output.

---

### `@walnut/util`

**Purpose**: General-purpose utility functions usable in Node.js, browser, or any JavaScript runtime.

**Source**: `packages/shared/src/utils/` (pure functions only — no browser APIs, no business logic)

**Scope**:
- `deepClone`, `deepMerge`, `isPlainObject` — Object utilities
- `set`, `get`, `unset`, `has` — Object path traversal
- `uniqueId`, `camelCase`, `kebabCase`, `capitalize` — String utilities
- `Queue`, `AsyncQueue`, `EventEmitter` — Data structures
- `fileSize`, `fileExt`, `mimeType` — File utilities (pure string operations only)
- `debounce`, `throttle`, `sleep`, `retry` — Async utilities
- `range`, `chunk`, `shuffle`, `uniq`, `uniqBy` — Array utilities

**NOT included**:
- `slotText()` — Admin-specific slot rendering → stays in `apps/admin/src/utils/`
- `deviceDetect()` — Browser-only, app-specific use → stays in `apps/admin/src/utils/`
- `persistent/` — Browser storage → has its own `@walnut/storage` package

---

### `@walnut/regex`

**Purpose**: Exportable regex patterns for validation. Zero dependencies.

**Source**: `packages/shared/src/utils/regex.ts`

**Scope**:
- Phone number patterns (Chinese, international)
- Email validation
- IP address (v4, v6)
- URL validation
- Password strength patterns
- Chinese ID card number
- Base64
- Hex color
- Domain name
- Date/ISO date

**Example export**:
```typescript
export const Patterns = {
  phone: /^1[3-9]\d{9}$/,
  email: /^[^\s@]+@[^\s@][^\s.@]*\.[^\s@]+$/,
  ipv4: /^(\d{1,3}\.){3}\d{1,3}$/,
  // ...
} as const
```

---

### `@walnut/crypto`

**Purpose**: Cryptographic primitives using Web Crypto API. Browser-only but could also include Node.js crypto fallback.

**Source**: `packages/shared/src/utils/crypto/`

**Scope**:
- `AES-GCM` encrypt/decrypt
- `RSA-OAEP` encrypt/decrypt
- `HKDF` key derivation
- `HMAC` sign/verify
- Signature derivation (ECDSA, Ed25519)

**NOT included**:
- OPAQUE protocol — this is a business-specific auth flow
- Application-specific key management — stays in admin

---

### `@walnut/storage`

**Purpose**: Browser storage abstraction wrapping localStorage, sessionStorage, IndexedDB, and Cookies with a unified API.

**Source**: `packages/shared/src/utils/persistent/`

**Scope**:
- `localStorage` with JSON serialization, TTL, namespace prefixing
- `sessionStorage` wrapper (same API, session-scoped)
- `IndexedDB` wrapper (Promise-based, schema management)
- `Cookie` wrapper (read/write/delete, domain/path/expires)
- `StorageInterface` — unified interface for swapping storage backends

**NOT included**:
- App-specific storage keys (remembered tab, layout preference) → stay in admin store
- Device fingerprint → stays in admin

---

### `@walnut/http`

**Purpose**: HTTP client utilities built on Axios. Framework-agnostic.

**Source**: `packages/axios/src/core/`, `packages/axios/src/adapters/`

**Scope**:
- `createHttpInstance` — Axios instance factory with config
- `RequestCache` — In-memory request cache with TTL
- `CancelManager` — Request cancellation via AbortController
- `RetryAdapter` — Exponential backoff retry logic
- `ThrottleAdapter` — Request throttling per URL
- `MergeAdapter` — Request deduplication (same URL, same params)
- Type definitions for request/response config

**NOT included**:
- Token interceptor → stays in `apps/admin/src/api/interceptors/`
- Signature interceptor → stays in `apps/admin/src/api/interceptors/`
- Encryption interceptor → stays in `apps/admin/src/api/interceptors/`
- Fingerprint interceptor → stays in `apps/admin/src/api/interceptors/`
- Walnut API response format → stays in `apps/admin/src/api/adapters/`

---

### `@walnut/ui`

**Purpose**: Framework-level Vue 3 components. These provide generic UI infrastructure that any Vue 3 app could use.

**Source**: `packages/ui/src/components/UI/`, `packages/ui/src/components/Extra/`, `packages/ui/src/components/HOC/`

**Scope**:
- `WTable` — Table engine with column configuration, sorting, filtering, pagination
- `WForm` — Form engine with field configuration, validation, layout
- `WDescriptions` — Description list component
- `EmailInput` — Email input with validation
- `IconPicker` — Icon selection component
- `HOC/withLoading`, `HOC/withPermission` — Higher-order component wrappers

**NOT included**:
- `Business/` — Dict, AvatarUpload, business-specific components → go to `apps/admin/src/components/Business/`
- `Advanced/` — WCRUD (business CRUD), ApiSelect (app API), RoleSelect → go to `apps/admin/src/components/Advanced/`
- `App/` — App-level layout components → stay in `apps/admin/src/layout/`

---

## Execution Strategy

Each package is moved **one at a time, in its own git commit**. This ensures:
1. Each commit is focused and reviewable
2. If something breaks, the breaking change is isolated to one commit
3. git bisect can pinpoint issues

### Execution Order (Dependency-Aware)

The order below respects the dependency graph. Each package is moved only after all its dependencies are in place.

```
                   ┌─────────┐
                   │  types  │  (zero dependencies)
                   └────┬────┘
                        │
              ┌─────────┼─────────┐
              │         │         │
              ▼         ▼         ▼
          ┌──────┐ ┌───────┐ ┌──────┐
          │ util │ │ regex │ │crypto│
          └──┬───┘ └───────┘ └──────┘
             │
       ┌─────┴─────┐
       │           │
       ▼           ▼
   ┌─────────┐ ┌──────┐
   │ storage │ │ http │
   └─────────┘ └──────┘


             ┌──────────┐
             │    ui    │
             └──────────┘

    (Then move core/ and ai/ back to apps/admin/)
```

### Step-by-step Execution

#### Step 1: Create `@walnut/types`

```bash
# Create package skeleton
mkdir -p packages/types/src
```

**`packages/types/package.json`**:
```json
{
  "name": "@walnut/types",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

**`packages/types/tsconfig.json`**:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist"
  },
  "include": ["src"]
}
```

Extract type definitions from:
- `types/custom.d.ts` (utility types)
- `types/global.d.ts` (ViteEnv, global types)
- `types/shims.d.ts` (Vue module shims)

**Verification**:
```bash
pnpm --filter @walnut/types build
# or if no build step, check types:
pnpm --filter @walnut/types exec tsc --noEmit
```

**Commit**:
```bash
git add -A && git commit -m "refactor(packages): extract @walnut/types package"
```

---

#### Step 2: Create `@walnut/util`

```bash
mkdir -p packages/util/src
```

Same package.json/tsconfig pattern as types.

Extract pure functions from `packages/shared/src/utils/`:
- `deepClone.ts`, `deepMerge.ts`, `isPlainObject.ts`
- `objectPath.ts` (set, get, unset, has)
- `queue.ts`, `asyncQueue.ts`
- `file.ts` (pure string-based file utilities)
- `debounce.ts`, `throttle.ts`, `sleep.ts`, `retry.ts`
- `array.ts` (range, chunk, shuffle, uniq)

Update imports across the codebase:
```bash
# Search for old import paths
grep -r "@walnut/shared" --include="*.ts" --include="*.vue" -l
# Replace: @walnut/shared → @walnut/util (for moved functions)
```

**Verification**:
```bash
pnpm types:check
pnpm --filter @walnut/server build  # if server uses @walnut/util
pnpm --filter @walnut/admin build   # if admin uses @walnut/util
```

**Commit**:
```bash
git add -A && git commit -m "refactor(packages): extract @walnut/util package"
```

---

#### Step 3: Create `@walnut/regex`

```bash
mkdir -p packages/regex/src
```

Extract `packages/shared/src/utils/regex.ts` into its own package.

Zero dependencies — this is purely a pattern collection.

**Verification**: `pnpm types:check`

**Commit**: `refactor(packages): extract @walnut/regex package`

---

#### Step 4: Create `@walnut/crypto`

```bash
mkdir -p packages/crypto/src
```

Extract `packages/shared/src/utils/crypto/` directory.

Depends on `@walnut/util` (for helpers like `bufferToHex`, `hexToBuffer`).

**Verification**: `pnpm types:check`

**Commit**: `refactor(packages): extract @walnut/crypto package`

---

#### Step 5: Create `@walnut/storage`

```bash
mkdir -p packages/storage/src
```

Extract `packages/shared/src/utils/persistent/` directory.

Depends on `@walnut/util`.

**Verification**: `pnpm types:check`

**Commit**: `refactor(packages): extract @walnut/storage package`

---

#### Step 6: Create `@walnut/http` + Move Interceptors Back to Admin

```bash
mkdir -p packages/http/src
```

Extract from `packages/axios/src/core/`:
- `httpConfig.ts`
- `httpInstance.ts`
- `cacheManager.ts`
- `cancelManager.ts`
- `retryAdapter.ts`
- `throttleAdapter.ts`
- `mergeAdapter.ts`

Extract from `packages/axios/src/adapters/`:
- Generic adapters only

**Move back to admin**:
```bash
mkdir -p apps/admin/src/api/interceptors/
mkdir -p apps/admin/src/api/adapters/
# Move business interceptors:
mv packages/axios/src/interceptors/* apps/admin/src/api/interceptors/
# Move business adapters:
mv packages/axios/src/adapters/* apps/admin/src/api/adapters/
```

Update all imports in `apps/admin/src/` that reference `@walnut/axios` — they should now point to either `@walnut/http` (for core HTTP utilities) or local `@/api/interceptors/` (for business interceptors).

**Verification**: `pnpm types:check && pnpm build:admin`

**Commit**: `refactor(packages): extract @walnut/http package, move business interceptors to admin`

---

#### Step 7: Create `@walnut/ui` + Move Business Components Back to Admin

```bash
mkdir -p packages/ui/src
```

Keep in `packages/ui/`:
- `components/UI/` — WTable, WForm, WDescriptions
- `components/Extra/` — EmailInput, IconPicker
- `components/HOC/` — withLoading, withPermission

**Move back to admin**:
```bash
mkdir -p apps/admin/src/components/Business/
mkdir -p apps/admin/src/components/Advanced/
mv packages/ui/src/components/Business/* apps/admin/src/components/Business/
mv packages/ui/src/components/Advanced/* apps/admin/src/components/Advanced/
mv packages/ui/src/components/App/* apps/admin/src/layout/
```

**Verification**: `pnpm types:check && pnpm build:admin`

If components use auto-imports, verify that `unplugin-vue-components` resolvers are updated to find components in the new locations.

**Commit**: `refactor(packages): extract @walnut/ui package, move business components to admin`

---

#### Step 8: Move `@walnut/core` Back to Admin

```bash
# Move stores
mv packages/core/src/stores/* apps/admin/src/store/modules/
# Move router
mv packages/core/src/router/* apps/admin/src/router/
# Move composables
mv packages/core/src/composables/* apps/admin/src/hooks/
# Move socket
mv packages/core/src/socket/* apps/admin/src/socket/
```

Update all imports across the admin app that reference `@walnut/core`.

Delete the `packages/core/` directory entirely.

**Verification**: `pnpm types:check && pnpm build:admin`

**Commit**: `refactor(packages): move @walnut/core back to apps/admin/`

---

#### Step 9: Move `@walnut/ai` Back to Admin

```bash
mkdir -p apps/admin/src/components/AI/
mv packages/ai/src/* apps/admin/src/components/AI/
```

Delete the `packages/ai/` directory entirely.

**Verification**: `pnpm types:check && pnpm build:admin`

**Commit**: `refactor(packages): move @walnut/ai back to apps/admin/`

---

#### Step 10: Clean up old package directories

After everything is moved:

```bash
# Remove old package directories that are now empty or partially moved
rm -rf packages/shared      # fully redistributed
rm -rf packages/axios       # replaced by @walnut/http
rm -rf packages/core        # fully moved back to admin
rm -rf packages/ai          # fully moved back to admin

# Update pnpm-workspace.yaml to reflect new package list
```

**Final `packages/` structure**:
```
packages/
├── types/
├── util/
├── regex/
├── crypto/
├── storage/
├── http/
└── ui/
```

**Commit**: `chore: clean up old package directories`

---

## Verification Checklist (per package move)

For each package move, verify:

- [ ] `pnpm types:check` passes (or pre-existing errors are unchanged)
- [ ] `pnpm --filter @walnut/admin build` succeeds
- [ ] `pnpm --filter @walnut/server build` succeeds (if server depends on the package)
- [ ] All old import paths are updated to new package names
- [ ] The old source files are deleted (no dead code)
- [ ] No business logic remains in the package
- [ ] The package can be described as "I could publish this to npm"

---

## Success Criteria for Phase 2

- [ ] Every package in `packages/` is non-business and project-agnostic
- [ ] No Pinia stores, Vue Router config, or app constants in packages/
- [ ] No business interceptors (token, signature, encryption, fingerprint) in packages/
- [ ] No business components (Dict, AvatarUpload, WCRUD, ApiSelect) in packages/
- [ ] All imports resolve correctly across all apps
- [ ] `pnpm build` completes for all apps (admin + server + docs)
- [ ] `pnpm types:check` passes (or pre-existing errors unchanged)
- [ ] `pnpm lint` passes (or pre-existing warnings unchanged)
- [ ] Old package directories (`shared`, `axios`, `core`, `ai`) completely removed

---

## Import Path Migration Guide

When moving code between packages, imports need to be updated. Here is the mapping:

### Old `@walnut/shared` imports

| Old Import | New Import | Notes |
|---|---|---|
| `@walnut/shared` (pure functions) | `@walnut/util` | deepClone, debounce, etc. |
| `@walnut/shared` (crypto) | `@walnut/crypto` | AES, RSA, HMAC |
| `@walnut/shared` (regex) | `@walnut/regex` | Patterns.phone, Patterns.email |
| `@walnut/shared` (persistent) | `@walnut/storage` | localStorage, IndexedDB |
| `@walnut/shared` (const) | `@/const/` | Business constants → local import |
| `@walnut/shared` (device) | `@/utils/` | Device detection → local import |

### Old `@walnut/axios` imports

| Old Import | New Import | Notes |
|---|---|---|
| `@walnut/axios` (core) | `@walnut/http` | HTTP instance, cache, retry |
| `@walnut/axios` (interceptors) | `@/api/interceptors/` | Token, sign, encrypt, fingerprint |
| `@walnut/axios` (adapters) | `@/api/adapters/` | Business adapters |

### Old `@walnut/core` imports

| Old Import | New Import | Notes |
|---|---|---|
| `@walnut/core/stores` | `@/store/modules/` | Pinia stores |
| `@walnut/core/router` | `@/router/` | Router config |
| `@walnut/core/composables` | `@/hooks/` | Composables |
| `@walnut/core/socket` | `@/socket/` | Socket client |

### Old `@walnut/ui` imports

| Old Import | New Import | Notes |
|---|---|---|
| `@walnut/ui` (UI/) | `@walnut/ui` | Stays — WTable, WForm |
| `@walnut/ui` (Extra/) | `@walnut/ui` | Stays — EmailInput, IconPicker |
| `@walnut/ui` (HOC/) | `@walnut/ui` | Stays — withLoading |
| `@walnut/ui` (Business/) | `@/components/Business/` | Dict, AvatarUpload |
| `@walnut/ui` (Advanced/) | `@/components/Advanced/` | WCRUD, ApiSelect, RoleSelect |

### Old `@walnut/ai` imports

| Old Import | New Import |
|---|---|
| `@walnut/ai` | `@/components/AI/` |

---

## Package.json Updates

When migrating, each target package's `package.json` needs:

### New-style package (TypeScript source direct consumption):

```json
{
  "name": "@walnut/xxx",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "dependencies": {
    "@walnut/util": "workspace:*"
  }
}
```

### Cross-package reference in consuming package.json:

```json
{
  "dependencies": {
    "@walnut/util": "workspace:*",
    "@walnut/types": "workspace:*"
  }
}
```

---

> **Next**: [09-known-issues.md](./09-known-issues.md) — Living document of known migration issues
