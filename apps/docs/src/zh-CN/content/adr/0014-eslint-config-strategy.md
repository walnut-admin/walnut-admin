# ADR-0014: ESLint Configuration Strategy

**Date:** 2026-07-29
**Status:** Accepted

## Context

The monorepo needs consistent code quality enforcement across frontend (Vue3 + Vite), backend (NestJS + SWC), and shared packages. ESLint v9+ mandates flat config format. The project had already migrated to flat config and extracted a shared config package (`@walnut/eslint-config`) without a formal architectural decision.

Three questions need explicit decisions:
1. Whether to maintain `@walnut/eslint-config` as a shared config package
2. Whether to adopt faster linting tools (oxlint, biome) alongside ESLint
3. How to handle Prettier integration

## Decision 1: Maintain `@walnut/eslint-config` as a Shared Config Package

**Chosen:** Keep `@walnut/eslint-config` as a workspace package with 3 presets.

**Rationale:**
- **Single source of truth** — upgrade an ESLint plugin once, all consumers pick it up
- **3 presets match the 3 runtime environments:**
  - `base.mjs` — TypeScript, `no-namespace: off`, `no-console: off`
  - `vue.mjs` — extends base + UnoCSS + Vue + TypeScript + pnpm catalog enforcement
  - `nest.mjs` — extends base + TypeScript project mode + NestJS-specific rules (decorator ordering, restrict frontend imports `@walnut/client`/`@walnut/axios`)
- **ESLint plugins live in the config package's `dependencies`** — consumers only need to `extends` the preset
- `eslint` itself is a `peerDependency` — avoids multiple ESLint versions coexisting

**Consumer pattern:**
```js
// apps/admin/eslint.config.mjs
import vueConfig from "@walnut/eslint-config/vue";
export default [...vueConfig];

// apps/server/eslint.config.mjs
import nestConfig from "@walnut/eslint-config/nest";
export default [...nestConfig];
```

**Alternatives considered:**
- Root-level monolithic config — rejected; would need project-specific globs and conditional rules, becoming unmaintainable as packages grow
- Per-package independent configs — rejected; duplicated rules, version drift in ESLint plugins

## Decision 2: No oxlint/biome — Continue ESLint Only

**Chosen:** Do not introduce oxlint or biome at this time.

**Rationale:**
- **oxlint**: does not support Vue SFC (`.vue` files) — this is a hard blocker for `apps/admin`
- **biome**: does not support Vue SFC; does not support custom rules (we have NestJS decorator-ordering rules)
- ESLint performance is adequate for this project's scale (~4 packages + 2 apps)
- Re-evaluate when oxlint or biome adds Vue SFC support

## Decision 3: Prettier at Root Level

**Chosen:** Single `.prettierrc` at monorepo root, no per-package Prettier configs.

**Rationale:**
- Formatting should be uniform across the entire monorepo
- `eslint-config-prettier` disables ESLint rules that conflict with Prettier
- Root `package.json` has `format` / `format:check` scripts for manual use
- `lint-staged` runs Prettier + ESLint on staged files in pre-commit hook

## Consequences

- ESLint configuration changes require updating `@walnut/eslint-config` only — all consumers pick up changes on next `pnpm install`
- No oxlint/biome adoption path until Vue SFC support lands (track [oxc#vue](https://github.com/oxc-project/oxc/issues?q=vue) and [biome#vue](https://github.com/biomejs/biome/issues?q=vue))
- Prettier + ESLint coexistence managed by `eslint-config-prettier` placed last in config arrays (flat config rule: later configs override earlier ones)

## Related

- `packages/eslint-config/` — source code for the config package
- `docs/reference/02-eslint-configuration.md` — industry standard practices for ESLint in monorepos
- `docs/adr/0012-toolchain-divergence.md` D7 — ESLint type-aware rules relaxed for workspace imports
