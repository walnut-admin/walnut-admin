# ADR-0012: Frontend-Backend Toolchain Divergence

**Date:** 2026-07-29
**Status:** Accepted

## Context

Walnut Admin uses two fundamentally different toolchains under one monorepo:

- **Frontend** (`@walnut/admin`): Vite 8 + ESM + `import.meta.env` static replacement
- **Backend** (`@walnut/server`): NestJS CLI + SWC + CJS + `@nestjs/config` runtime env loading

This divergence is not an accident — it reflects the different deployment models (static SPA vs long-running Node process) and has cascading effects on TypeScript configuration, environment variable handling, and Turborepo cache strategy.

## Decision 1: Server tsconfig Does NOT Extend Any `@walnut/tsconfig` Preset

**Chosen:** `apps/server/tsconfig.json` is self-contained. It does NOT extend any `@walnut/tsconfig` preset (`base.json` / `ts.json` / `vue.json`), and it never extended the root `tsconfig.base.json` that the presets replaced (that file was deleted on 2026-09-23, see [ADR 0019](/content/adr/0019-tsconfig-presets-and-no-mjs)).

**Why the shared baseline is incompatible with the server:**

| Option | `@walnut/tsconfig` baseline (`base.json` / `vue.json`) | `apps/server/tsconfig.json` (backend) |
|--------|--------------------------------------------------------|---------------------------------------|
| `module` | `ESNext` | `commonjs` |
| `moduleResolution` | `bundler` | `node` |
| `target` | `ESNext` | `es2022` |
| `experimentalDecorators` | — (not set) | `true` (required by NestJS) |
| `emitDecoratorMetadata` | — (not set) | `true` (required by NestJS) |
| `noEmit` | `true` (Vite handles output) | `false` (SWC needs `.js` output) |
| `verbatimModuleSyntax` | `true` | incompatible with CJS `require()` |
| `erasableSyntaxOnly` | `true` in `ts.json` | not set (SWC handles decorators/emit) |

Forcing the server to extend a shared preset would require `compilerOptions` overrides for every single divergent field — defeating the purpose of a shared base. Worse, a future developer adding a frontend-oriented option to a preset (e.g., `jsx: "preserve"`, which lives in `vue.json`) could silently break the server build. The presets were split by **runtime environment** precisely so that this class of assumption stops leaking across packages; the server sits outside all three environments.

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

## Decision 4: No Cross-Package tsconfig Paths (Community Standard)

**Chosen:** Remove all cross-package `paths` entries for `@walnut/contract` and `@walnut/utils` from server tsconfig and SWC configs. Rely solely on pnpm workspace protocol + `package.json` `exports`.

**Rationale (community consensus, 2025):**

1. **tsconfig `paths` overrides `package.json` `exports`** — when TypeScript matches a paths alias, it resolves directly to the filesystem path and completely skips `exports`, `main`, and `types` fields. This means the `exports` field (carefully configured per ADR 0002 for dual-mode consumption) becomes dead weight during type-checking.

2. **Single source of truth** — `workspace:*` in `package.json` + `exports` in the dependency's `package.json` is sufficient. Cross-package paths duplicate this and create maintenance burden (4 files to keep in sync: 1 tsconfig + 3 SWC configs).

3. **Mirrors real npm resolution** — when (if) these packages are published to npm, consumers will resolve through `node_modules` + `exports`, not through tsconfig paths. Keeping only the workspace protocol ensures dev behavior matches publish behavior.

**Files cleaned (2026-07-29):**
- `apps/server/tsconfig.json` — removed `@walnut/contract` and `@walnut/utils` paths
- `apps/server/infra/swc/dev.swcrc` — removed same
- `apps/server/infra/swc/prod.swcrc` — removed same
- `apps/server/infra/swc/stage.swcrc` — removed same

**What was kept:**
- `@walnut-server/*` paths — these point to server-internal NestJS libraries (`libs/*`) which are NOT pnpm workspace packages. These paths are the only resolution mechanism for internal libs (no `workspace:*` protocol exists for them).
- `@/*` paths — local convenience alias within each package (`src/*`), not cross-package.

## Consequences

1. **Turborepo cache correctness:** `turbo build` now correctly invalidates when any `VITE_*` variable or mode changes.
2. **Server tsconfig isolation is documented:** Future maintainers won't try to "fix" the server by making it extend a shared preset.
3. **Env loading model is explicit:** The build-time-static vs runtime-loading distinction is recorded, preventing confusion about which vars need turbo.json declarations.
4. **The `VITE_*` wildcard pattern is future-proof:** Adding a new `VITE_*` variable to the Zod schema automatically gets cache tracking without touching `turbo.json`.
5. **Cross-package resolution is workspace-native:** `@walnut/contract` and `@walnut/utils` resolve via pnpm symlinks + `package.json` `exports`, consistent with how they'd resolve if published to npm. The 4 previously duplicated paths entries are eliminated.

## Decision 5: Strict Hoisting with Minimal Exceptions

**Chosen:** Maintain `hoist: false` with a short `publicHoistPattern` exception list made of **exact package names** (no globs).

*(Key names: pnpm's key is `hoist`, not `hoisting` — the misspelling is silently ignored by pnpm 11 and rejected outright by pnpm 12; and since pnpm 10 moved non-auth settings out of `.npmrc`, both settings live in `pnpm-workspace.yaml` as `hoist` / `publicHoistPattern`. Details in [pnpm-workspace.yaml 配置详解](/content/monorepo/pnpm-workspace-config).)*

**Rationale:**
- `hoist: false` provides strict dependency isolation — each package can only import what it declares in `dependencies`/`devDependencies`
- 7 exceptions, every one of them a third-party defect (knip reports 0 undeclared dependencies in our own source), are necessary because the offending package cannot resolve them from its own position:
  - `@types/sortablejs` — `@vueuse/integrations`' optional peer needs its types resolvable from there
  - `@typescript-eslint/types` — `@unocss/eslint-plugin`'s output imports it without declaring it
  - `@chevrotain/regexp-to-ast`, `vscode-jsonrpc`, `vscode-languageserver-protocol`, `vscode-languageserver-types` — `langium` imports 4 undeclared packages (only via `chevrotain` / `vscode-languageserver`)
  - `vue` — `vue-command-palette`'s output imports `'vue'`, with neither `dependencies` nor `peerDependencies` declared
- **The old glob list is gone.** `*turbo*` / `*eslint*` / `*@swc*` / `*esbuild*` described packages that are root `package.json` direct dependencies anyway, so the patterns had no effect (recorded in the archived 2026-09-21 architecture review — pnpm 10 stopped reading those settings from `.npmrc`). The `*simple-git-hooks*` entry is gone for good with the lefthook migration ([ADR 0018](/content/adr/0018-git-hooks-lefthook)): the dependency itself was removed, and `lefthook` needs no hoist exception — it is a root devDependency that only requires an `allowBuilds: true` entry.
- Growth rate is near zero — re-evaluate if the list exceeds 10 patterns

## Decision 6: Tag-Based Architecture Boundaries (Turbo 2.9)

**Chosen:** Enable tag-based boundaries in root `turbo.json` with per-package `turbo.json` tag declarations.

**Tags assigned (2026-09-23 更新——platform 维度，对应 ADR 0017 的目录分组；`packages/tooling/` 拆成 5 包后同步为 14 行):**

| Package | Tags |
|---------|------|
| `@walnut/admin` | `app`, `frontend`, `platform-web` |
| `@walnut/server` | `app`, `backend`, `platform-node` |
| `@walnut/docs` | `app`, `docs` |
| `@walnut/utils` | `shared`, `pure`, `platform-any` |
| `@walnut/contract` | `shared`, `pure`, `platform-any` |
| `@walnut/types` | `shared`, `pure`, `platform-any` |
| `@walnut/client` | `shared`, `platform-web` |
| `@walnut/http` | `shared`, `platform-web` |
| `@walnut/ui` | `shared`, `platform-web` |
| `@walnut/tsconfig` | `tooling`, `platform-any` |
| `@walnut/eslint-config` | `tooling`, `platform-any` |
| `@walnut/commitlint-config` | `tooling`, `platform-any` |
| `@walnut/vitest-config` | `tooling`, `platform-any` |
| `@walnut/scripts` | `tooling`, `platform-any` |
| `@walnut/release` | `tooling`, `platform-any` |

> 本表随包增删更新：上面的 15 行与工作区里的 15 个包一一对应。6 个 tooling 包的 workspace 级
> `turbo.json` 都声明 `"tags": ["tooling", "platform-any"]`。
> 历史沿革：`@walnut/commitlint-config` 与 `@walnut/release` 是 2026-08-08 之后加入的；`@walnut/release`
> 2026-09-23 曾改名 `@walnut/tooling`（收编根 `scripts/`，见 [ADR 0018](/content/adr/0018-git-hooks-lefthook)），
> 同日再随 tooling 拆包恢复为 `@walnut/release`，并新增 `@walnut/tsconfig` / `@walnut/scripts` /
> `@walnut/vitest-config`
> （见 [ADR 0019](/content/adr/0019-tsconfig-presets-and-no-mjs)）。

**Rules:**
1. `shared` packages cannot depend on `app` packages (libraries must not import application code)
2. `backend` packages cannot depend on `platform-web` packages (server must not import `@walnut/client`/`@walnut/http`/`@walnut/ui`)
3. `platform-any` packages cannot depend on `platform-web` or `platform-node` (platform-agnostic packages stay runtime-free)
4. `platform-node` packages cannot depend on `platform-web`

**Result:** 0 tag-rule violations (at implementation on 2026-07-29, over the 8 packages that existed then; `pnpm boundaries` now covers all 15 workspace packages and reports "no issues found").

**Turbo feature status:** Experimental feature in Turbo 2.9. Rules are enforced via `turbo boundaries` CLI. API may change in future Turbo versions.
<!-- 刻意不写 `**Status:**` —— 那是 ADR 自己的状态字段（本文件第 4 行），`pnpm lint:adr` 只认第一个匹配，
     但同一文件出现两个同名字段会让人（和未来的解析器）读错。 -->

**Known limitations (pre-existing, not caused by boundaries):**
- `~build/package` Vite virtual module — not a real dependency, but boundaries treats unknown imports as violations
- `node_modules/zod` deep import in `validate-env.ts` — pre-existing code smell, not a cross-package boundary concern
- `vitest/config` in packages without explicit `vitest` devDependency — pre-existing, vitest is installed via pnpm

## Decision 7: ESLint Type-Aware Rules Relaxed for Workspace Imports

**Chosen:** Downgrade `ts/no-unsafe-*` rules from `error` to `warn` in the `nest` ESLint config.

**Rationale:**
- `@typescript-eslint` type-aware rules (`ts/no-unsafe-assignment`, `ts/no-unsafe-member-access`, etc.) use TypeScript's type checker through the ESLint plugin
- When importing `as const` objects from pnpm workspace packages (e.g., `MenuType`, `Locale`, `Role` from `@walnut/contract`), the ESLint type checker cannot resolve literal types through workspace symlinks
- TypeScript's own `tsc --noEmit` has 0 errors — the types are correct, the ESLint rules produce false positives
- Downgrading to `warn` keeps the rules visible for real violations in local code while preventing false-positive build failures

**This is a known limitation of pnpm workspaces + type-aware linting**, documented in the `@typescript-eslint` project. If/when TypeScript's type resolver improves workspace symlink handling, these rules can be restored to `error`.

## Alternatives considered

### Decision 5: 严格 hoist 与最小例外清单

- **完全去掉 `hoist: false`** —— 否决；会放任幻影依赖（包导入了自己没声明的依赖）。
- **更细粒度的按包 hoist** —— 否决；只增加配置复杂度，没有收益。

## Related

- [ADR 0002](0002-dual-mode-consumption.md) — dual-mode package consumption (source for Vite, CJS build for backend)
- [ADR 0005](0005-jit-vs-build.md) — JIT for frontend-only packages, CJS build for shared packages
- [ADR 0007](0007-backend-libs-not-workspace.md) — backend NestJS libraries stay as internal monorepo
- [ADR 0019](0019-tsconfig-presets-and-no-mjs.md) — 共享 tsconfig 预设包（`@walnut/tsconfig`），server 仍不继承任何预设
- [`monorepo/typescript.md`](/content/monorepo/typescript) — detailed tsconfig topology
  (the old `docs/architecture/05-tsconfig-strategy.md` no longer exists; the root `docs/` directory was folded into this site)
