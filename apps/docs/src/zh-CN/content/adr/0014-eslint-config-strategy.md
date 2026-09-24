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
- **3 presets match the 3 runtime environments**（2026-09-23 起全部为 `.ts`，见 [ADR 0019](0019-tsconfig-presets-and-no-mjs.md)）:
  - `base.ts` — TypeScript, `no-namespace: off`, `no-console: off` (currently zero consumers — shared packages mostly have no local ESLint config; `packages/platform-web/ui` writes one and uses the `vue` preset, the rest fall back to the root `vue` preset via upward resolution)
  - `vue.ts` — extends base + UnoCSS + Vue + TypeScript + pnpm catalog enforcement
  - `nest.ts` — extends base + TypeScript project mode + NestJS-specific rules (decorator ordering via the local `nest-local-rules.ts` plugin, restrict frontend imports `@walnut/client`/`@walnut/http`/`@walnut/ui`)
- **ESLint plugins live in the config package's `dependencies`** — consumers only need to `extends` the preset
- `eslint` itself is a `peerDependency` — avoids multiple ESLint versions coexisting
- **ESLint loads `eslint.config.ts` through `jiti`** (ESLint's official TS config loader), which is why the root gained a `jiti` devDependency. The package's own `types:check` is a real `tsc --noEmit` (it used to be a no-op `echo`)

**Consumer pattern:**
```ts
// apps/admin/eslint.config.ts
import vueConfig from "@walnut/eslint-config/vue";
export default vueConfig();

// apps/server/eslint.config.ts
import nestConfig from "@walnut/eslint-config/nest";
export default nestConfig();
```

## Decision 2: No oxlint/biome — Continue ESLint Only

**Chosen:** Do not introduce oxlint or biome at this time.

**Rationale:**
- **oxlint**: official Vue SFC support is still at the RFC stage; third-party plugins (`oxlint-vue` and friends) exist but are not mature — for a `.vue` surface the size of `apps/admin`, the risk outweighs the gain
- **biome**: likewise no official Vue SFC support; and no custom-rule support (we have a NestJS decorator-ordering rule of our own)
- ESLint performance is adequate at this project's scale
- Re-evaluate when oxlint or biome ships official Vue SFC support

> **Last revised:** 2026-09-23 —— 措辞修正。上面两条原先写的是「**不支持** Vue SFC」，
> 那是个已经过期的绝对判断：事实是**官方框架支持仍在 RFC 阶段**，第三方插件可用但不成熟。
> 结论（暂不作为主 linter）不变，理由换成了经得起复查的那条。

## Decision 3: Prettier Deprecated — Formatting via ESLint

**Chosen:** Prettier is no longer used. Formatting is handled by ESLint's stylistic rules (from the `@antfu` presets). There is no `.prettierrc`, no `eslint-config-prettier`, and no `format` / `format:check` scripts; `lint-staged` runs ESLint only on staged files in the pre-commit hook.

**Rationale:**
- One tool covers both linting and formatting — no config drift between a formatter and ESLint rules
- The `@antfu` stylistic rules make a separate Prettier setup redundant

## Alternatives considered

### Decision 1: 把 `@walnut/eslint-config` 作为共享配置包维护

- **根级单体配置** —— 否决；需要按项目写 glob 与条件规则，随包增多会变得无法维护。
- **各包各自独立配置** —— 否决；规则重复，ESLint 插件版本会漂移。

## Consequences

- ESLint configuration changes require updating `@walnut/eslint-config` only — all consumers pick up changes on next `pnpm install`
- No oxlint/biome adoption path until official Vue SFC support lands (track [oxc#vue](https://github.com/oxc-project/oxc/issues?q=vue) and [biome#vue](https://github.com/biomejs/biome/issues?q=vue))
- No Prettier — formatting is enforced purely via ESLint stylistic rules; re-introducing Prettier would require `eslint-config-prettier` to be placed last in config arrays (flat config rule: later configs override earlier ones)

## Related

- `packages/tooling/eslint-config/` — source code for the config package（预设为 `base.ts` / `vue.ts` / `nest.ts`，另有本地规则插件 `nest-local-rules.ts`）
- [ADR 0012](0012-toolchain-divergence.md) Decision 7 — ESLint type-aware rules relaxed for workspace imports
- [ADR 0019](0019-tsconfig-presets-and-no-mjs.md) — 全仓 `.mjs` → `.ts`（含本包的 4 个文件：3 个预设 + `nest-local-rules`），以及 `jiti` 的引入
- `apps/docs/src/zh-CN/content/industry-research/02-eslint-configuration.md` — industry standard practices for ESLint in monorepos
- [`monorepo/eslint.md`](/content/monorepo/eslint) — operator-facing ESLint guide
