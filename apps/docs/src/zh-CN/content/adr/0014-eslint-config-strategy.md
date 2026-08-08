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
  - `base.mjs` — TypeScript, `no-namespace: off`, `no-console: off` (currently zero consumers — shared packages have no local `eslint.config.mjs` and fall back to the root Vue preset via upward resolution)
  - `vue.mjs` — extends base + UnoCSS + Vue + TypeScript + pnpm catalog enforcement
  - `nest.mjs` — extends base + TypeScript project mode + NestJS-specific rules (decorator ordering, restrict frontend imports `@walnut/client`/`@walnut/http`)
- **ESLint plugins live in the config package's `dependencies`** — consumers only need to `extends` the preset
- `eslint` itself is a `peerDependency` — avoids multiple ESLint versions coexisting

**Consumer pattern:**
```js
// apps/admin/eslint.config.mjs
import vueConfig from "@walnut/eslint-config/vue";
export default vueConfig();

// apps/server/eslint.config.mjs
import nestConfig from "@walnut/eslint-config/nest";
export default nestConfig();
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

## Decision 3: Prettier Deprecated — Formatting via ESLint

**Chosen:** Prettier is no longer used. Formatting is handled by ESLint's stylistic rules (from the `@antfu` presets). There is no `.prettierrc`, no `eslint-config-prettier`, and no `format` / `format:check` scripts; `lint-staged` runs ESLint only on staged files in the pre-commit hook.

**Rationale:**
- One tool covers both linting and formatting — no config drift between a formatter and ESLint rules
- The `@antfu` stylistic rules make a separate Prettier setup redundant

## Consequences

- ESLint configuration changes require updating `@walnut/eslint-config` only — all consumers pick up changes on next `pnpm install`
- No oxlint/biome adoption path until Vue SFC support lands (track [oxc#vue](https://github.com/oxc-project/oxc/issues?q=vue) and [biome#vue](https://github.com/biomejs/biome/issues?q=vue))
- No Prettier — formatting is enforced purely via ESLint stylistic rules; re-introducing Prettier would require `eslint-config-prettier` to be placed last in config arrays (flat config rule: later configs override earlier ones)

## Related

- `packages/tooling/eslint-config/` — source code for the config package
- `apps/docs/src/zh-CN/content/industry-research/02-eslint-configuration.md` — industry standard practices for ESLint in monorepos
- `docs/adr/0012-toolchain-divergence.md` D7 — ESLint type-aware rules relaxed for workspace imports
