# 05 · TypeScript 策略

> 本文件详述 monorepo 的 TypeScript 配置架构、已发现的 tsconfig 缺陷及修复状态、以及为何不采用 TS Project References。
> 更新于 2026-07-26。

---

## 1. 当前 tsconfig 拓扑

仓库有 **2 个根级 tsconfig** + 各 workspace 自己的 tsconfig。关系靠 `extends` 维护，**没有 `references` / `composite`**。

### 1.1 两个根级 tsconfig

```
tsconfig.json              ← 根工具配置（覆盖根 *.mjs/.ts/.js；extends base，仅覆盖 lib）
tsconfig.base.json         ← 前端共享 base（admin + docs + 3 packages 都 extends 它）
```

> 历史：曾有三个根级 tsconfig，`tsconfig.base.node.json`（后端共享 base）已于 2026-07-26 删除——它是零消费者的孤儿文件（详见 §3.1 历史）。

### 1.2 extends 链（实测图）

```
[前端 ESM 世界]
tsconfig.base.json
  ├── tsconfig.json                   (根工具配置；extends base，覆盖 lib:[ESNext]，include 根 *.mjs/*.ts/*.js)
  ├── apps/admin/tsconfig.json        (extends base, 覆盖 baseUrl, 加 @/* ~/*)
  ├── apps/docs/tsconfig.json         (extends base, 加 types:[node])
  ├── packages/shared/tsconfig.json   (extends base, 加 baseUrl:.)
  ├── packages/axios/tsconfig.json    (extends base, 加 baseUrl:., include ../shared/types)
  └── packages/core/tsconfig.json     (extends base, 加 baseUrl:., include ../shared/types)

[后端 CJS 世界 —— 完全独立]
apps/server/tsconfig.json             (⚠️ 不 extends 任何根 base，自包含)
  └── apps/server/apps/api/tsconfig.app.json   (extends ../../tsconfig.json，即 server 自己的)
      + 9 个 apps/server/libs/*/tsconfig.lib.json   (各自 extends ../../tsconfig.json)

注意：apps/server/* 下的 extends "../../tsconfig.json" 解析到 apps/server/tsconfig.json
（server 自己的），不是仓库根的 tsconfig.json。仓库根 tsconfig.json 没有任何 tsconfig extends 它。
```

### 1.3 各 tsconfig 的关键设置

| 配置 | target | module | moduleResolution | decorators | paths | baseUrl |
|------|--------|--------|------------------|-----------|-------|---------|
| `tsconfig.base.json` | ESNext | ESNext | bundler | ❌ | `@walnut/{shared,axios,core,ui,ai}` → `./packages/*/src` | （未设） |
| `tsconfig.base.node.json` | ES2022 | commonjs | node10 | ✅ emitDecoratorMetadata + experimentalDecorators | （无） | （未设） |
| `apps/admin/tsconfig.json` | (继承) | (继承) | (继承) | ❌ | `@/*`→src/*, `~/*`→types/* | `.`（覆盖） |
| `apps/server/tsconfig.json` | es2022 | commonjs | （未显式，默认 node10） | ✅ | `@/*`, `@walnut/{9 个 lib}` → `./libs/*/src` | （未设） |
| `apps/docs/tsconfig.json` | (继承) | (继承) | (继承) | ❌ | （无） | `.` |

**两个世界**：
- 前端（admin/docs/packages）：ESM + bundler resolution + Vue JSX + 无装饰器
- 后端（server）：CJS + node10 resolution + 装饰器（NestJS 必须）

这种异构性是后续讨论 Project References 时的核心约束。

---

## 2. 内部包模式：源码直消费

### 2.1 工作机制

前端 packages 不构建、不发布。它们的 `package.json` `exports` 直接指向 `.ts` 源码：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  }
}
```

消费者（admin、docs）通过 pnpm workspace symlink + package `exports`，直接 import 到 `.ts` 源文件。Vite（dev/build）和 tsc（types:check）都能解析这种形式，因为：
- Vite 原生支持 `.ts` 源
- tsc 的 `moduleResolution: "bundler"` 允许解析 `exports` 字段和 `.ts` 扩展

### 2.2 实际 import 形式

admin 几乎从不用 bare import `@walnut/shared`（因为 index.ts 是空的），全部走 subpath：

```ts
// 实际写法
import { useSharedPreferredReducedMotion } from '@walnut/core/hooks/vueuse/usePreferredReducedMotion'
import { AppAxios } from '@walnut/axios/instance'
import { encryptAesGcm } from '@walnut/shared/crypto/symmetric/aes-gcm'
```

`@walnut/core/hooks/vueuse/usePreferredReducedMotion` 通过 `exports` 的 `./*` → `./src/*.ts` 映射，解析到 `packages/core/src/hooks/vueuse/usePreferredReducedMotion.ts`。

### 2.3 这个模式的好处

- **零构建开销**：packages 没有 build 步骤（`build: echo 'no build needed'`）
- **即时 HMR**：改 packages/shared 的源码，admin 的 Vite dev server 立即热更新
- **类型精确**：tsc 直接看源码，go-to-definition 跳到原始 `.ts`，不是编译后的 `.d.ts`

### 2.4 这个模式的代价

- **消费者必须支持 `moduleResolution: bundler`**：后端是 `node10`，所以**后端不能消费这些 packages**。这正是后端零 workspace 依赖的原因之一（另一个原因是后端不需要前端的东西）。
- **bare import 拿不到东西**：所有 index.ts 都空着，必须 subpath import。反直觉，新人容易踩坑。
- **跨包类型要 hack**：见 §3.3。

---

## 3. tsconfig 缺陷清单及修复状态

> 更新于 2026-07-26。原列 3 个缺陷，#1/#2 已修，#3 待办。

### 3.1 ✅ 缺陷 #1：`tsconfig.base.node.json` 是孤儿（已删除）

**现象**：`tsconfig.base.node.json` 定义了一份完整的后端 CJS + 装饰器 base 配置，但**没有任何 tsconfig extends 它**。

**证据**（grep 所有 tsconfig 的 `extends` 字段）：

```
=== extends tsconfig.base.node ===
（零命中）
```

`apps/server/tsconfig.json` 是自包含的——它直接写了 `module: commonjs`、`emitDecoratorMetadata: true` 等，**没有 extends `tsconfig.base.node.json`**。

**影响**：死文件，误导维护者以为有共享后端 base。

**推测成因**：合并时（commit `99548f7 "Phase B — TypeScript config restructuring"`）计划让 server extends 这个 base，但实际没接线。或 server 的自包含配置与 base 有细微差异（如 `composite: false`、`declaration: false`），不好直接 extends。

**修复方案**：二选一（见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 2）：
- **方案 A**：删除 `tsconfig.base.node.json`（最简单）
- **方案 B**：让 `apps/server/tsconfig.json` extends 它，移除重复的 CJS/装饰器设置（消除配置重复）

**✅ 已解决**（2026-07-26，commit `7f58970`）：采用方案 A，直接删除。`apps/server/tsconfig.json` 保持自包含（与 base 有 `composite: false`、`declaration: false` 等差异，强行 extends 不划算）。

---

### 3.2 ✅ 缺陷 #2：`baseUrl` 覆盖导致 inherited `paths` 失效（已删除 paths）

**现象**：`tsconfig.base.json` 定义了 `paths` 映射 `@walnut/*`，但子配置覆盖 `baseUrl` 后，这些 paths **实际解析到错误位置**。

**详细机制**：

1. `tsconfig.base.json` 第 11-17 行：
   ```json
   "paths": {
     "@walnut/shared": ["./packages/shared/src"],
     "@walnut/axios":  ["./packages/axios/src"],
     ...
   }
   ```
   这些路径是**仓库根相对**的（`./packages/...`）。base 自己**没设 baseUrl**。

2. TS 的规则：`paths` 里的非相对路径基于 `baseUrl` 解析。如果 `baseUrl` 未设，TS 推断为"声明 paths 的 tsconfig 所在目录"——即仓库根。所以理论上 paths 指向 `<repo-root>/packages/...`。

3. 但 `apps/admin/tsconfig.json` **覆盖**了 `baseUrl`：
   ```json
   "compilerOptions": {
     "baseUrl": ".",   // ← 相对 admin/tsconfig.json，即 apps/admin/
     ...
   }
   ```
   TS 配置合并规则：`baseUrl` 不是相对的，它相对于**设置它的文件**解析。所以 admin 的 `baseUrl: "."` = `apps/admin/`。

4. **关键**：当子配置重新声明 `baseUrl`，TS 用**子配置的 baseUrl** 解析继承来的 paths。于是 base 里的 `@walnut/shared → ./packages/shared/src` 被解析为 `apps/admin/packages/shared/src`——**这个路径不存在**。

**为什么 admin 还能工作？** 三个因素叠加：

1. **admin 几乎不用 bare import**：如 §2.2 所述，admin 全走 subpath（`@walnut/shared/crypto/...`）。base 的 `paths` 只映射了**精确**的 bare key（`"@walnut/shared"`），没映射 `@walnut/shared/*`。所以 subpath import **根本不经过 paths**。

2. **pnpm symlink + exports 接管**：`@walnut/shared` 是真实 workspace 包，被 symlink 到 `apps/admin/node_modules/@walnut/shared`。subpath import（如 `@walnut/shared/crypto/...`）通过 node_modules symlink + package `exports` 解析——**完全不靠 tsconfig paths**。

3. **Vite 不管 tsconfig paths**：admin 的 `vite.config.ts` 只定义 `@` 和 `axios/lib` 别名，不定义 `@walnut/*`。Vite 靠 node_modules 解析 `@walnut/*`，独立于 tsconfig。

**结论**：`tsconfig.base.json` 的 `paths` 块对前端来说**基本是摆设**。它只会在有人写 bare import `import { foo } from '@walnut/shared'` 时触发，而那种情况下：
- 如果在 admin 里：会错解析到 `apps/admin/packages/shared/src`（不存在）→ TS 报错
- 如果在 packages 里（如 packages/core import shared）：baseUrl 也是 `.`，同样错解析

**实际没人踩这个坑**，因为所有人都习惯了 subpath import。但这是脆弱的"靠约定工作"。

**修复方案**（见 Phase 2）：
- **方案 A（推荐）**：在 `tsconfig.base.json` 自身设 `baseUrl: "."`，让 paths 相对于 base 文件（仓库根）解析。然后确保子配置**不要**覆盖 baseUrl（或覆盖时重新声明完整 paths）。
- **方案 B**：从 base 删除 `paths`，承认它没用，全靠 pnpm symlink + exports。
- **方案 C**：把 paths 改成 `@walnut/shared/*` 形式（含 wildcard），让 subpath 也走 paths（但会和 exports 双重解析，不推荐）。

**✅ 已解决**（2026-07-26，commit `f4936e8`）：采用方案 B，从 `tsconfig.base.json` 删除整个 `paths` 块。验证：`git grep` 确认零 bare import（所有消费走 subpath），删除后 admin/server/3 个 packages 的 types:check 全通过。paths 是摆设，删除后语义更清晰——未来 bare import 会显式 TS 报错（fail loud 优于静默错解析）。

---

### 3.3 ⚠️ 缺陷 #3：跨包 `.d.ts` 相对路径 reach（待办，比预想复杂）

**现象**：4 个 tsconfig 通过相对路径 `include` 跨包的 ambient `.d.ts` 文件。

**实测清单**：

| 文件 | include 条目 | 目标 |
|------|-------------|------|
| `apps/admin/tsconfig.json` | `"../../packages/shared/src/types/*.d.ts"` | shared 的 7 个 ambient 类型 |
| `packages/axios/tsconfig.json` | `"../shared/src/types/*.d.ts"` | 同上 |
| `packages/core/tsconfig.json` | `"../shared/src/types/*.d.ts"` | 同上 |
| `packages/shared/tsconfig.json` | `"../shared/src/types/*.d.ts"` | 自身（无害） |

**这些 `.d.ts` 是什么**：`packages/shared/src/types/` 下 7 个文件（`deep-ref.d.ts`、`object-key.d.ts`、`storage.d.ts`、`universal.d.ts`、`vite.d.ts`、`vue-runtime.d.ts`、`vue.d.ts`）。它们是 **ambient 类型声明**（`declare global` 或全局类型），不通过 import 消费，而是靠"被纳入 TS 编译程序"自动生效。

**为什么要跨包 reach**：因为这些是 ambient 全局类型（如 `Recordable`、`DeepKeyOf`），不是可 import 的模块。要让 admin/core/axios 用到这些类型，必须把 `.d.ts` 文件**纳入它们的 TS 程序**——于是用相对路径 include。

**为什么这是 hack**：
1. **脆弱**：路径硬编码，packages/shared 改目录结构就断
2. **隐式依赖**：admin 的 tsconfig 默默依赖 shared 的内部文件结构，无显式声明
3. **不可扩展**：每加一个 ambient 类型消费者，就要在它 tsconfig 加一行 include

**修复方案**（见 Phase 2）：
- **方案 A（推荐）**：把 `packages/shared/src/types/*.d.ts` 从 ambient 全局转成**显式模块**（`export interface Recordable<T> { ... }`），消费者 `import type { Recordable } from '@walnut/shared/types/recordable'`。这样通过 exports 正常解析，无需跨包 include。
- **方案 B**：保留 ambient，但把所有消费者的 include 统一抽到一个共享 tsconfig 配置（如 `tsconfig.base.json` 加 include——但 include 不能被 extends 继承，所以这不可行）。
- **方案 C**：维持现状，文档化为"已知 hack"。

方案 A 工作量稍大（要改 7 个 .d.ts + 所有消费点），但最干净。

**⚠️ 复杂度补充**（2026-07-26 重新评估）：这 7 个 `.d.ts` 不全是简单的 ambient 全局类型。实测：
- `universal.d.ts`、`deep-ref.d.ts`、`object-key.d.ts`、`storage.d.ts` 是 `declare global { ... } export {}` 形式（可转显式模块，但要改大量消费点——admin 裸用 `Recordable` 31 文件、`Fn` 23 文件、`IDeepMaybeRef` 6 文件）
- `vite.d.ts`、`vue.d.ts`、`vue-runtime.d.ts` 是**模块扩充**（`declare module '*.vue'`、`declare module '@vue/runtime-dom'`），不能简单加 `export`

因此 #7 不能机械改造，需逐个甄别。当前 ambient 全局类型被 admin 大量裸用（60+ 文件），改成显式 import 是独立工程，留作未来。

---

### 3.4 ✅ 缺陷 #4：根 `tsconfig.json` 与 `tsconfig.base.json` 内容重复（已修）

**现象**（2026-07-26 新发现）：根 `tsconfig.json`（给根级 `eslint.config.mjs` 等脚本用）曾**手抄**了 `tsconfig.base.json` 的 11 个 compilerOptions（target、module、moduleResolution、strict、noEmit、esModuleInterop、isolatedModules、skipLibCheck 等），没有 extends base。

**影响**：维护负担——改 base 忘了改根，两者漂移。根 tsconfig 还缺 base 的 `ignoreDeprecations: "6.0"`，可能在根级检查时冒 deprecation 警告。

**✅ 已解决**（2026-07-26，commit `140e94e`）：根 `tsconfig.json` 改为 `extends: "./tsconfig.base.json"`，只保留它独有的差异：
- `lib: ["ESNext"]`（覆盖 base 的 `["DOM","ESNext","DOM.Iterable"]`——根脚本是 Node 环境，无 DOM）
- `include: ["*.mjs", "*.ts", "*.js"]`（根 tsconfig 独有的文件范围）
- `exclude` 保留

**安全性核查**：确认仓库内**没有任何 tsconfig extends 根 `tsconfig.json`**（`apps/server/*` 的 `extends: "../../tsconfig.json"` 解析到 `apps/server/tsconfig.json` 即 server 自己的，不是仓库根）。所以重构零下游影响。验证：`tsc -p tsconfig.json --noEmit` 通过；全量 `pnpm types:check` 9/9 通过。

---

## 4. 为何不采用 TS Project References / composite

TypeScript Project References（`composite: true` + `references` 数组）是 TS 官方推荐的 monorepo 方案。但**本仓库不适合采用**。以下是针对本仓库具体情况的 6 条论证。

### 4.1 异构工具链冲突

TS Project References 要求所有被引用的 project 是 `composite: true`，且设置一致。但本仓库同时有：

| 世界 | module | moduleResolution | decorators | 构建工具 |
|------|--------|-----------------|-----------|----------|
| 前端 admin | ESNext | bundler | ❌ | Vite |
| 前端 docs | ESNext | bundler | ❌ | VitePress |
| 前端 packages | ESNext | bundler | ❌ | （无构建，源码直消费） |
| 后端 server | commonjs | node10 | ✅ | NestJS CLI + SWC |

把它们塞进一个 composite 图，要么：
- 强制统一设置（前端 ESM 被迫改成 CJS，或后端被迫改成 ESM）——破坏现有构建
- 每个 package 维护多套 tsconfig（前端版/后端版）——复杂度爆炸

### 4.2 与"源码直消费"模式冲突

Project References 的设计前提是 `tsc -b` 产出 `.d.ts`/`.js`，消费者引用**构建产物**。但本仓库的内部包模式故意**不构建**（`build: echo 'no build needed'`），让消费者直接吃源码以获得即时 HMR。

引入 references 意味着要么：
- 每次 dev 都先 `tsc -b` 所有 packages（慢，破坏 HMR）
- 用 `disableSourceOfProjectReferenceRedirect` 等 hack 绕过——但这又抵消了 references 的好处

### 4.3 Vite 和 VitePress 不认 references

实际构建工具（Vite、VitePress）通过 node_modules + exports 解析，**不读 TS references**。references 只影响 `tsc --noEmit` 类型检查。所以 references 只对 `turbo types:check` 有边际收益（增量类型检查），但对 dev/build 零价值。

### 4.4 后端不参与前端依赖图

后端 `apps/server` 零 workspace 依赖（不消费任何 `packages/*`）。它的 9 个内部 lib 通过自己的 tsconfig paths + NestJS-CLI + SWC 编译。给后端加 references 到前端 packages 既无必要也无意义。而前端的 references 图里也不该包含后端。所以 references 图天然只覆盖前端——而前端 packages 只有 3 个真包（shared/axios/core），图很小，references 的增量编译收益微乎其微。

### 4.5 `tsbuildinfo` 协调开销

References 引入 `.tsbuildinfo` 文件协调增量构建。这些文件：
- 需要 `.gitignore`（已忽略）
- 需要正确的清理时机（`tsc -b --clean`）
- 容易因过期/损坏导致诡异类型错误（业界常见抱怨）

对一个小型前端 packages 图（3 个真包），这个开销不划算。

### 4.6 49 个 subpath import 的兼容性风险

admin 有 49 处 `@walnut/core/hooks/...` subpath import。这些目前靠 `exports` 的 `./*` → `./src/*.ts` 工作。引入 references + composite 后，composite project 的 exports 行为可能变化（composite 要求 declaration 输出，subpath 解析可能要适配）——需要逐一验证 49 个 import 仍能解析。这是未知风险。

### 4.7 结论

| 维度 | 当前"源码直消费 + extends + paths" | TS Project References |
|------|-------------------------------------|----------------------|
| Vite/VitePress HMR | ✅ 无缝（吃源码） | ⚠️ 需不在 dev 跑 `tsc -b`，references 无 dev 收益 |
| NestJS 后端 | ✅ 已分离（libs/ 独立） | ❌ 需建独立 composite 图，跨 runtime 设置冲突 |
| 类型检查速度 | 每次从头查源码 | `tsc -b` 增量可能更快——但仓库小，收益边际 |
| 构建产物 | 无需（echo scripts） | 必须每包产 `.d.ts` 或用 `noEmit` 绕过 |
| 复杂度 | 低（需修 §3 的 3 个缺陷） | 高（每消费者独立 tsconfig、tsbuildinfo、排序约束） |
| 对 49 个 subpath import 的风险 | 零（解析方式不变） | 需逐一验证 |

**建议**：保持"源码直消费"模式，只修 §3 的 3 个缺陷。Project References 的收益（边际增量编译）不抵代价（异构工具链冲突 + 模式重写 + 兼容性风险）。

业界趋势也支持这个选择：Turbo 官方文档的 TypeScript 指南现在也推荐"内部包 + 源码直消费"模式，Project References 在 Vite 时代的重要性下降。

---

## 5. 内部包模式的正确做法（修复后）

修复 §3 的 3 个缺陷后，前端 tsconfig 应该是这样：

### 5.1 `tsconfig.base.json`（修复后）

```jsonc
{
  "compilerOptions": {
    // ... 现有 ESM/bundler/Vue 设置保持
    "baseUrl": ".",                    // ← 新增：让 paths 相对 base 文件（仓库根）解析
    "paths": {
      "@walnut/shared": ["./packages/shared/src"],
      "@walnut/axios":  ["./packages/axios/src"],
      "@walnut/core":   ["./packages/core/src"],
      "@walnut/contract": ["./packages/contract/src"]    // ← Phase 4 新增
      // ui/ai 删除（Phase 3）
    }
    // ...
  }
}
```

### 5.2 子配置（修复后）

`apps/admin/tsconfig.json`、`packages/*/tsconfig.json`：
- **不要**覆盖 `baseUrl`（或覆盖时重新声明完整 paths）
- **移除** `../../packages/shared/src/types/*.d.ts` 的 include（改用 import type）

### 5.3 ambient 类型转显式模块（修复后）

`packages/shared/src/types/deep-ref.d.ts` 从：

```ts
// ambient 全局
type DeepKeyOf<T> = ...
```

改为：

```ts
// 显式模块
export type DeepKeyOf<T> = ...
```

消费：

```ts
import type { DeepKeyOf } from '@walnut/shared/types/deep-ref'
```

通过 `exports` 正常解析，告别跨包 include。

> 完整执行步骤见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 2。

---

## 6. tsconfig 健康度小结

| 维度 | 状态 | 说明 |
|------|------|------|
| 前端共享 base | ⚠️ 有缺陷 | `paths` 因 baseUrl 覆盖失效（靠 pnpm symlink 兜底） |
| 后端共享 base | ❌ 孤儿 | `tsconfig.base.node.json` 零消费者 |
| 跨包类型共享 | ⚠️ hack | 4 处相对路径 include ambient .d.ts |
| Project References | ❌ 不适用 | 异构工具链冲突，收益不抵代价（已论证） |
| 内部包模式 | ✅ 基本正确 | 源码直消费工作正常，只需修上述缺陷 |

---

## 下一步

- 完整问题清单 → [07-known-issues.md](./07-known-issues.md)
- 修 tsconfig → [08-refactor-plan.md](./08-refactor-plan.md) Phase 2
