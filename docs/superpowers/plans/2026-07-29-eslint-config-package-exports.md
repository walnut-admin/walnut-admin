# ESLint Config Package + Package Exports Refinement

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a shared `@walnut/eslint-config` package with thin per-workspace shims, and fill package `index.ts` barrel files with curated public API re-exports while preserving subpath tree-shaking.

**Architecture:** Create `packages/eslint-config/` with 3 presets (base/vue/nest). Each workspace gets a 1-line shim. Server's 249-line custom decorator rule moves into the shared package. For packages, fill the empty `index.ts` files with explicit named re-exports (never `export *`) covering the public surface — subpath deep imports remain functional for tree shaking.

**Tech Stack:** ESLint 10 (flat config), `@antfu/eslint-config` 8.2, pnpm workspace protocol, TypeScript 6

---

## Current State (Baseline)

### ESLint Config Distribution

| Workspace | Own Config? | Actually Uses | Problem |
|-----------|------------|---------------|---------|
| root (`eslint.config.mjs`) | Yes (full) | root, admin, shared, axios, core | Implicit cascade to 4 workspaces |
| apps/admin | **No** | Inherits root | No pnpm rules, no explicit dependency |
| apps/server | Yes (full, 249-line custom rule) | server only | Full config inline, custom rule trapped in repo |
| apps/docs | Yes (full) | docs only | Full config inline |
| packages/shared | **No** | Inherits root | Same as admin |
| packages/axios | **No** | Inherits root | Same as admin |
| packages/core | **No** | Inherits root | Same as admin |

### Package Exports

All three packages use:
```json
"exports": {
  ".": "./src/index.ts",       // ← EMPTY FILE (0 bytes)
  "./*": "./src/*.ts"          // ← all real work
}
```
- **100% subpath imports** — zero bare imports in the entire codebase
- All `index.ts` files are zero bytes (empty)
- Tree shaking is optimal with current pattern
- No curated public API surface defined

---

## Task A: Shared ESLint Config Package

### Task A1: Create `packages/eslint-config/` skeleton

**Files:**
- Create: `packages/eslint-config/package.json`

```json
{
  "name": "@walnut/eslint-config",
  "type": "module",
  "version": "0.0.0",
  "private": true,
  "exports": {
    "./base": "./base.mjs",
    "./vue": "./vue.mjs",
    "./nest": "./nest.mjs"
  },
  "dependencies": {
    "@antfu/eslint-config": "catalog:"
  },
  "peerDependencies": {
    "eslint": "catalog:"
  }
}
```

- [ ] Create directory `packages/eslint-config/`
- [ ] Create `packages/eslint-config/package.json` with above content

### Task A2: Create `packages/eslint-config/base.mjs`

**Files:**
- Create: `packages/eslint-config/base.mjs`

Extract from root `eslint.config.mjs` — the rules that apply to ALL workspaces:

```js
import antfu from '@antfu/eslint-config'

export default function baseConfig(options = {}) {
  return antfu({
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
    markdown: false,
    rules: {
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
    },
    ...options,
  })
}
```

- [ ] Create `packages/eslint-config/base.mjs`

### Task A3: Create `packages/eslint-config/vue.mjs`

**Files:**
- Create: `packages/eslint-config/vue.mjs`

For admin, docs, and Vue-using packages:

```js
import antfu from '@antfu/eslint-config'

export default function vueConfig(options = {}) {
  return antfu({
    ignores: [
      '**/dist/**',
      'pnpm-lock.yaml',
    ],
    markdown: false,
    unocss: true,
    vue: true,
    typescript: true,
    pnpm: true,
    rules: {
      'ts/no-namespace': 'off',
      'no-console': 'off',
      'regexp/no-unused-capturing-group': 'off',
      'pnpm/yaml-enforce-settings': 'off',
    },
    ...options,
  })
}
```

- [ ] Create `packages/eslint-config/vue.mjs`

### Task A4: Create `packages/eslint-config/nest.mjs`

**Files:**
- Create: `packages/eslint-config/nest.mjs`
- Create: `packages/eslint-config/nest-local-rules.mjs` (moved from server)

Copy server's `eslint-local-rules.mjs` into the shared package, then create the nest preset:

```js
import antfu from '@antfu/eslint-config'
import localRules from './nest-local-rules.mjs'

export default function nestConfig(options = {}) {
  return antfu(
    {
      typescript: {
        tsconfigPath: './tsconfig.json',
      },
      jsonc: false,
      yaml: false,
      markdown: false,
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/public/js/**',
        '**/*.d.ts',
        '**/*/strategy.ts',
        'playwright/**/*.ts',
        'scripts/**/*.ts',
      ],
      rules: {
        'no-console': 'off',
        'ts/no-this-alias': 'off',
        'no-empty-pattern': 'off',
      },
    },
    {
      files: ['packages/config/**/*.ts'],
      rules: {
        'ts/strict-boolean-expressions': 'off',
      },
    },
    {
      files: ['**/*.ts'],
      plugins: {
        local: localRules,
      },
      rules: {
        'ts/consistent-type-imports': ['error', {
          prefer: 'type-imports',
          disallowTypeAnnotations: false,
          fixStyle: 'separate-type-imports',
        }],
        'local/sort-nestjs-decorators': 'error',
      },
    },
    ...options,
  )
}
```

- [ ] Copy server's `eslint-local-rules.mjs` → `packages/eslint-config/nest-local-rules.mjs`
- [ ] Create `packages/eslint-config/nest.mjs`

### Task A5: Update root `eslint.config.mjs` to thin shim

**Files:**
- Modify: `eslint.config.mjs`

```js
import vueConfig from '@walnut/eslint-config/vue'

export default vueConfig()
```

- [ ] Replace root config with thin shim

### Task A6: Create `apps/admin/eslint.config.mjs`

**Files:**
- Create: `apps/admin/eslint.config.mjs`

```js
import vueConfig from '@walnut/eslint-config/vue'

export default vueConfig()
```

- [ ] Create `apps/admin/eslint.config.mjs`

### Task A7: Update `apps/server/eslint.config.mjs` to thin shim

**Files:**
- Modify: `apps/server/eslint.config.mjs`
- Delete: `apps/server/eslint-local-rules.mjs` (moved to shared package)

```js
import nestConfig from '@walnut/eslint-config/nest'

export default nestConfig()
```

- [ ] Replace server config with thin shim
- [ ] Delete `apps/server/eslint-local-rules.mjs`

### Task A8: Update `apps/docs/eslint.config.mjs` to thin shim

**Files:**
- Modify: `apps/docs/eslint.config.mjs`

```js
import vueConfig from '@walnut/eslint-config/vue'

export default vueConfig({
  ignores: [
    '**/node_modules/**',
    '**/dist/**',
    '.vitepress/cache/**',
    '.vitepress/dist/**',
    'nginx/**',
  ],
  rules: {
    'style/no-tabs': 'off',
    'vue/no-unused-refs': 'warn',
    'import/newline-after-import': 'warn',
  },
})
```

- [ ] Replace docs config with thin shim

### Task A9: Add `@walnut/eslint-config` as devDependency

**Files:**
- Modify: `package.json` (root)
- Modify: `apps/admin/package.json`
- Modify: `apps/server/package.json`
- Modify: `apps/docs/package.json`
- Modify: `packages/shared/package.json`
- Modify: `packages/axios/package.json`
- Modify: `packages/core/package.json`

Add to each `devDependencies`:
```json
"@walnut/eslint-config": "workspace:*"
```

- [ ] Add workspace dep to all 7 package.json files

### Task A10: Clean up redundant devDependencies

**Files:**
- Modify: `apps/admin/package.json` — remove `@unocss/eslint-config`, `@unocss/eslint-plugin`, `eslint-plugin-vue` (now in shared config)
- Modify: `apps/docs/package.json` — remove `@antfu/eslint-config` if present
- Modify: `apps/server/package.json` — remove `@antfu/eslint-config` if present

- [ ] Remove eslint-related deps that are now inherited from shared config
- [ ] Run `pnpm install` to update lockfile

### Task A11: Verify — run lint across all workspaces

```bash
pnpm lint
```

- [ ] All workspaces pass lint with zero errors
- [ ] Server's `sort-nestjs-decorators` rule still works

---

## Task B: Package Exports — Curated Public API

### Task B1: Fill `@walnut/shared/src/index.ts` with curated re-exports

**Files:**
- Modify: `packages/shared/src/index.ts`

Based on actual usage (71 import sites), re-export the public API:

```ts
// ── Types ──────────────────────────────────────────
export type { Fn, PromiseFn, IActionType } from './types/universal'
export type {
  IDeepMaybeRef,
  SafeDeepMaybeRef,
  IsPrimitive,
  IsUnion,
  ExtractDeepRefValue,
} from './types/deep-ref'
export type { IStorageSync, IStorageAsync, IStorageOptions, IStorageData } from './types/storage'
export type {
  UnionToIntersection,
  RecordToUnion,
  ShortEmits,
  DeepKeyOf,
} from './types/object-key'

// ── Utilities ──────────────────────────────────────
export {
  getDefaultSlotText,
  isInSetup,
  getBoolean,
  getFunctionBoolean,
  detectDeviceType,
  getIsInIncognitoMode,
  getCPUCoreCount,
  getMemoryGB,
  getGPUArchitecture,
  objectToPaths,
  pathsToObject,
  toUrlSafeBase64,
  fromUrlSafeBase64,
  mockListApi,
} from './shared'

// ── Queue ──────────────────────────────────────────
export { SingletonPromise } from './queue'

// ── Regex ──────────────────────────────────────────
export { isEmailAddress, isPhoneNumber } from './regex'

// ── Crypto ─────────────────────────────────────────
export { aesGcmEncrypt, aesGcmDecrypt } from './crypto/symmetric/aes-gcm'
export { generateRsaOaepKeyPair } from './crypto/asymmetric/rsa-oaep'
export { hmacSha256 } from './crypto/mac/hmac-sha256'
export { deriveApiSignKey } from './crypto/derive/api-sign-key'
export {
  arrayBufferToBase64,
  uint8ArrayToBase64,
  base64ToUint8Array,
} from './crypto/transformer'
export {
  exportAesKeyToRaw,
  generateAes256Key,
  importRsaPublicKey,
  importAesKeyFromRaw,
} from './crypto/shared'

// ── File ───────────────────────────────────────────
export { downloadByUrl, downloadByBase64, downloadByBlob } from './file/download'
export { blobToBase64, base64ToBlob, imgUrlToBase64 } from './file/base64'

// ── Persistent ─────────────────────────────────────
export { useAppStorageSync } from './persistent/storage/sync'
export { useAppStorageAsync } from './persistent/storage/async'
export {
  enhancedAesGcmLocalStorage,
  enhancedBase64LocalStorage,
} from './persistent/enhance/index'
export { removeStorageItemsContaining } from './persistent/shared'

// ── Window ─────────────────────────────────────────
export { wbtoa } from './window/base64'
```

- [ ] Fill `packages/shared/src/index.ts` with all actual public exports
- [ ] Verify: `tsc --noEmit` on shared package passes

### Task B2: Fill `@walnut/axios/src/index.ts` with curated re-exports

**Files:**
- Modify: `packages/axios/src/index.ts`

```ts
// ── Types ──────────────────────────────────────────
export type { BaseResponse, BaseListParams, BaseListResponse } from './types'

// ── Instance ───────────────────────────────────────
export { AppAxios } from './instance'

// ── Constants ──────────────────────────────────────
export { BusinessCodeConst, notAllowedErrorCodeMap } from './constant'

// ── Utils ──────────────────────────────────────────
export { generateNonce } from './utils'

// ── Adapters ───────────────────────────────────────
export { composeAdapters } from './adapters/index'
export {
  removeCurrentPageRequests,
  removeAllCancel,
  removeLatestRequest,
} from './adapters/cancel'
```

- [ ] Fill `packages/axios/src/index.ts`
- [ ] Verify: `tsc --noEmit` on axios package passes

### Task B3: Fill `@walnut/core/src/index.ts` with curated re-exports

**Files:**
- Modify: `packages/core/src/index.ts`

```ts
// ── Core Hooks ─────────────────────────────────────
export { useState } from './hooks/core/useState'
export { useProps } from './hooks/core/useProps'
export { useLocalRefresh } from './hooks/core/useLocalRefresh'
export { useContext } from './hooks/core/useContext'

// ── VueUse Hooks ───────────────────────────────────
export { useBattery } from './hooks/vueuse/useBattery'
export { useBreakpoints } from './hooks/vueuse/useBreakpoints'
export { useDocumentVisibility } from './hooks/vueuse/useDocumentVisibility'
export { useDraggableElement } from './hooks/vueuse/useDraggableElement'
export { useIntervalFnWithPercent } from './hooks/vueuse/useIntervalFnWithPercent'
export { useNavigatorLanguage } from './hooks/vueuse/useNavigatorLanguage'
export { useNetwork } from './hooks/vueuse/useNetwork'
export { usePreferredReducedMotion } from './hooks/vueuse/usePreferredReducedMotion'
export { useResize } from './hooks/vueuse/useResize'

// ── Web Hooks ──────────────────────────────────────
export { useBlob } from './hooks/web/useBlob'
export { useLinkTag } from './hooks/web/useLinkTag'

// ── Component Hooks ────────────────────────────────
export { useGlobalAsyncComponent } from './hooks/component/useGlobalAsyncComponent'
```

- [ ] Fill `packages/core/src/index.ts`
- [ ] Verify: `tsc --noEmit` on core package passes

### Task B4: Verify tree shaking is preserved

```bash
cd apps/admin && pnpm build 2>&1 | tail -5
```

- [ ] Build succeeds
- [ ] Bundle size does not increase (subpath imports still work, barrel is additive only)

### Task B5: Verify — full type check across monorepo

```bash
pnpm types:check
```

- [ ] Zero type errors across all workspaces

---

## Verification Checklist

After all tasks complete:

- [ ] `pnpm lint` — zero errors across all 7 workspaces
- [ ] `pnpm types:check` — zero errors  
- [ ] `pnpm build` — all apps build successfully
- [ ] `apps/server` decorator sort rule still functional
- [ ] Bundle size unchanged (barrel is additive, subpath still tree-shakes)
- [ ] `pnpm install` — lockfile consistent
