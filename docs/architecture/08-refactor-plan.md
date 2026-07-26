# 08 · 详尽改造方案

> **这是操作手册。** 5 个 Phase，每个含：目标、精确改动清单（文件+行号+前后对比）、不动的部分、验证命令、风险。
> 数据采集时间：2026-07-26 · 基于 commit `fc455fc`

---

## 总览

| Phase | 目标 | 改动量 | 风险 | 依赖 |
|-------|------|--------|------|------|
| [Phase 1](#phase-1-命名空间隔离-walnut--walnut-server) | `@walnut/*` → `@walnut-server/*`（后端） | 4 配置 + 388 源文件 | 中（机械替换，需精确） | 无 |
| [Phase 2](#phase-2-tsconfig-清理) | 删孤儿 base、修 paths、消除跨包 reach | ~8 tsconfig + 7 .d.ts | 低-中 | 无 |
| [Phase 3](#phase-3-空壳包处置) | 删除 ui/ai | 2 目录 + 1 package.json | 极低 | 无 |
| [Phase 4](#phase-4-契约包-walnutcontract) | 引入共享契约包 | 1 新包 + 多处 re-export | 中（跨前后端） | Phase 1（命名空间清晰后再加 contract） |
| [Phase 5](#phase-5-cicd-修复) | PR CI + test task + 修 deploy | turbo.json + 2 workflow | 低 | 无 |

**建议顺序**：Phase 1 → 2 → 3 → 4 → 5。Phase 1/2/3 互相独立可调换，但 Phase 4 依赖 Phase 1（命名空间清晰后再引入跨 scope 的 contract）。

**每个 Phase 一次提交**（conventional commit）：
```
refactor(server): rename @walnut/* lib aliases to @walnut-server/*
chore: consolidate tsconfig, remove orphan base, fix cross-package type reach
refactor: remove empty @walnut/ui and @walnut/ai stub packages
feat: introduce @walnut/contract package for shared types and constants
ci: add PR workflow, turbo test task, fix monorepo deploy
```

---

## Phase 1：命名空间隔离（`@walnut/*` → `@walnut-server/*`）

### 目标
解决 [问题 #1](./07-known-issues.md#问题-1--walnut-命名空间双重定义)：后端 9 个 path 别名 lib 从 `@walnut/*` 改名到 `@walnut-server/*`，消除 scope 重叠。

### 动机
详见 [03-package-boundaries.md](./03-package-boundaries.md)。核心：当前靠"名字不重叠"侥幸不冲突，任何人加 `@walnut/utils` 前端包就会静默炸掉。

### 改动清单

#### 1.1 配置文件（4 个，必须改）

**文件 1：`apps/server/tsconfig.json`**

定位 `paths` 块（第 21-79 行附近）。当前形如：

```jsonc
"paths": {
  "@/*": ["./apps/api/src/*"],
  "@walnut/config":      ["./libs/config/src"],
  "@walnut/config/*":    ["./libs/config/src/*"],
  "@walnut/const":       ["./libs/const/src"],
  "@walnut/const/*":     ["./libs/const/src/*"],
  "@walnut/context":     ["./libs/context/src"],
  "@walnut/context/*":   ["./libs/context/src/*"],
  "@walnut/db":          ["./libs/db/src"],
  "@walnut/db/*":        ["./libs/db/src/*"],
  "@walnut/decorators":  ["./libs/decorators/src"],
  "@walnut/decorators/*":["./libs/decorators/src/*"],
  "@walnut/exceptions":  ["./libs/exceptions/src"],
  "@walnut/exceptions/*":["./libs/exceptions/src/*"],
  "@walnut/pipes":       ["./libs/pipes/src"],
  "@walnut/pipes/*":     ["./libs/pipes/src/*"],
  "@walnut/types":       ["./libs/types/src"],
  "@walnut/types/*":     ["./libs/types/src/*"],
  "@walnut/utils":       ["./libs/utils/src"],
  "@walnut/utils/*":     ["./libs/utils/src/*"]
}
```

改为（每条 `@walnut/` → `@walnut-server/`）：

```jsonc
"paths": {
  "@/*": ["./apps/api/src/*"],
  "@walnut-server/config":      ["./libs/config/src"],
  "@walnut-server/config/*":    ["./libs/config/src/*"],
  "@walnut-server/const":       ["./libs/const/src"],
  "@walnut-server/const/*":     ["./libs/const/src/*"],
  // ... 其余 7 个同理
}
```

**文件 2/3/4：`apps/server/infra/swc/{dev,prod,stage}.swcrc`**

每个文件有 `jsc.paths` 块（结构与 tsconfig paths 一致）。三个文件都做同样的 `@walnut/` → `@walnut-server/` 替换。

> ⚠️ **必须保持 tsconfig 和 swcrc 同步**：SWC 编译时用 swcrc 的 paths，tsc 类型检查用 tsconfig 的 paths。两者必须一致，否则编译通过但类型检查报错（或反之）。

#### 1.2 源文件（388 个，机械替换）

**范围**：`apps/server/apps/` 和 `apps/server/libs/` 下所有 `.ts` 和 `.d.ts` 文件。

**替换规则**：对 9 个已知 alias 做精确前缀替换：

```
@walnut/config      → @walnut-server/config
@walnut/const       → @walnut-server/const
@walnut/context     → @walnut-server/context
@walnut/db          → @walnut-server/db
@walnut/decorators  → @walnut-server/decorators
@walnut/exceptions  → @walnut-server/exceptions
@walnut/pipes       → @walnut-server/pipes
@walnut/types       → @walnut-server/types
@walnut/utils       → @walnut-server/utils
```

**推荐的 sed 命令**（在 `apps/server/` 下执行）：

```bash
# 注意：必须按"长名优先"排序，避免 @walnut/config 误匹配（这里没有前缀包含关系，但仍建议逐个替换）
for alias in config const context db decorators exceptions pipes types utils; do
  # .ts 文件
  find apps libs -name "*.ts" -type f -exec sed -i "s|@walnut/${alias}|@walnut-server/${alias}|g" {} +
  # .d.ts 文件
  find apps libs -name "*.d.ts" -type f -exec sed -i "s|@walnut/${alias}|@walnut-server/${alias}|g" {} +
done
```

**逐 alias 影响计数**（用于事后核验）：

| Alias | 引用文件数 | import 次数 |
|-------|-----------|-------------|
| `@walnut/const` | 188 | 292 |
| `@walnut/db` | 171 | 172 |
| `@walnut/decorators` | 100 | 130 |
| `@walnut/utils` | 82 | 97 |
| `@walnut/exceptions` | 61 | 84 |
| `@walnut/config` | 15 | 17 |
| `@walnut/types` | 15 | 11* |
| `@walnut/pipes` | 9 | 9* |
| `@walnut/context` | 5 | 7 |
| **合计** | **388 去重** | **819** |

`*` types/pipes 的文件数 > import 次数，因部分文件只在注释里提及 alias。

**核验命令**（替换后跑）：

```bash
# 1. 确认零残留
grep -rn "@walnut/" apps/server/apps apps/server/libs --include="*.ts" --include="*.d.ts" | grep -v "@walnut-server/" | grep -v "@walnut/contract"
# 期望：零输出（除了未来 Phase 4 的 @walnut/contract）

# 2. 确认新 alias 已生效
grep -rn "@walnut-server/" apps/server/apps apps/server/libs --include="*.ts" --include="*.d.ts" | wc -l
# 期望：~819 左右
```

#### 1.3 不动的部分（关键，避免误改）

| 文件 | 为什么不动 |
|------|-----------|
| `apps/server/package.json` 的 `"name": "@walnut/server"` | 这是包名本身（一个 app 包），不是 lib alias。保留 |
| `apps/server/infra/nest/{dev,prod,stage}.json` | 用短名（`config`、`db`）和文件系统路径（`libs/config/src`），**不引用 alias**。改了反而坏 |
| `apps/server/package.json` 的 `build:libs` 脚本 | 用短名 `nest build config`，通过 nest-cli 的 `projects` 映射解析，不走 alias |
| `apps/server/apps/api/tsconfig.app.json` | 只有相对路径 `include`（`../../libs/config/src/**`），无 alias 字符串 |
| `apps/server/apps/api/vitest.config.ts` | 用 `vite-tsconfig-paths` 自动读 tsconfig paths，tsconfig 改了它自动生效 |
| `apps/server/libs/*/tsconfig.lib.json`（9 个） | 无 `paths`，只 extends + outDir |
| `apps/admin/` 下任何文件 | 前端不消费后端 alias（已 grep 验证零命中） |

#### 1.4 可选清理（不影响功能）

- **~12 处 `// Note:` 注释**提到旧 alias，如：
  - `apps/server/apps/api/src/decorators/crud/types.d.ts:1` — `// ... global from @walnut/decorators/...`
  - `apps/server/apps/api/src/decorators/walnut/log.operate.decorator.ts:154` — `// ... moved to @walnut/types/...`
  - 其余散落在 `guard/throttler.guard.ts`、`socket/socket.const.ts` 等
- **11 个 `apps/server/libs/*/README.md`** 文档化了旧 alias 路径（如 `libs/context/README.md:70`、`libs/const/README.md:10-22`）

建议一并更新，保持文档一致。

### 验证

```bash
# 1. 类型检查
pnpm --filter @walnut/server types:check
# 期望：通过，无 "Cannot find module '@walnut/...'" 错误

# 2. 单元测试
pnpm --filter @walnut/server test
# 期望：通过

# 3. 构建（可选，较慢）
pnpm --filter @walnut/server build
# 期望：dist/walnut/admin/com/app/main.js 正常产出
```

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 漏改某个文件导致 `Cannot find module` | 核验命令 §1.2 的 grep 残留检查 |
| 误改 `@walnut/server`（包名）为 `@walnut-server/server` | sed 只针对 9 个已知 alias，不碰 `@walnut/server` 这个完整字符串 |
| tsconfig 和 swcrc 不同步 | 改完 4 个配置文件后，diff 确认 4 处 paths 块一致 |
| 注释里的旧 alias 残留（不影响编译但混淆） | 可选清理 §1.4 |

### 提交信息

```
refactor(server): rename @walnut/* lib aliases to @walnut-server/*

Resolve namespace collision between frontend workspace packages
(@walnut/{shared,axios,core,...}) and backend path-alias libs
(@walnut/{config,const,db,...}). Backend libs now use @walnut-server/*
scope, eliminating the risk of silent misresolution when adding new
frontend packages.

Changes:
- apps/server/tsconfig.json: paths block (18 entries)
- apps/server/infra/swc/{dev,prod,stage}.swcrc: jsc.paths blocks
- 388 source files under apps/server/{apps,libs}: import path migration

No behavioral change. NestJS-CLI build (infra/nest/*.json) unaffected
(uses short lib names + filesystem paths, not aliases).
```

---

## Phase 2：tsconfig 清理

### 目标
解决问题 #5（孤儿 base）、#6（baseUrl/paths 错配）、#7（跨包 .d.ts reach）。

### 改动清单

#### 2.1 处理 `tsconfig.base.node.json` 孤儿

**二选一**：

**方案 A（推荐，最简单）：删除**

```bash
rm tsconfig.base.node.json
```

同时更新 `turbo.json` 的 `globalDependencies`（如果列了它——当前没列，但确认一下）。

**方案 B：让 server extends 它**

修改 `apps/server/tsconfig.json`，把重复的 CJS/装饰器设置移到 base，server 只 extends：

```jsonc
// apps/server/tsconfig.json（方案 B 后）
{
  "extends": "../../tsconfig.base.node.json",
  "compilerOptions": {
    "outDir": "./dist",
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/.cache/tsconfig.tsbuildinfo",
    "composite": false,
    "types": ["node", "jest"],
    "paths": {
      // ... @walnut-server/* paths（Phase 1 后）
    }
  }
}
```

但要注意：base.node 没有 `target`（server 是 `es2022`，base.node 也是 `es2022` ✓）、没有 `outDir`（server 有）、`declaration`（base.node 是 true，server 是 false ✗）——有差异，需仔细对齐。

**推荐方案 A**（删除），因为 server 的自包含配置已经工作良好，强行 extends 引入对齐负担。

#### 2.2 修复 baseUrl/paths 错配

**目标**：让 `tsconfig.base.json` 的 `paths` 真正生效（即使有人写 bare import 也能解析）。

**修改 `tsconfig.base.json`**：在 `compilerOptions` 加 `baseUrl: "."`：

```jsonc
{
  "compilerOptions": {
    // ... 现有设置
    "baseUrl": ".",                    // ← 新增
    "paths": {
      "@walnut/shared":   ["./packages/shared/src"],
      "@walnut/axios":    ["./packages/axios/src"],
      "@walnut/core":     ["./packages/core/src"],
      "@walnut/contract": ["./packages/contract/src"]   // ← Phase 4 加
      // ui/ai 删除（Phase 3）
    }
    // ...
  }
}
```

`baseUrl: "."` 相对于 `tsconfig.base.json` 所在目录（仓库根），所以 `./packages/shared/src` 解析为 `<repo-root>/packages/shared/src`。✓

**修改子配置**（admin/docs/packages）：**移除** `baseUrl: "."` 覆盖。

但是！子配置有自己的 `paths`（如 admin 的 `@/*`→`src/*`）。`paths` 需要 `baseUrl` 才能解析。如果移除子的 `baseUrl`，子的 `paths` 会基于继承来的 base baseUrl（仓库根）解析——`@/*` → `<repo-root>/src/*`，错误。

**正确做法**：子配置保留自己的 `baseUrl: "."`，但**重新声明完整 paths**（合并 base 的 + 自己的）：

```jsonc
// apps/admin/tsconfig.json（修复后）
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      // 自己的
      "@/*": ["src/*"],
      "~/*": ["types/*"],
      // 重新声明继承的（因为 baseUrl 变了，base 的 paths 相对这个新 baseUrl 解析）
      "@walnut/shared":   ["../../packages/shared/src"],
      "@walnut/axios":    ["../../packages/axios/src"],
      "@walnut/core":     ["../../packages/core/src"],
      "@walnut/contract": ["../../packages/contract/src"]
    }
    // ...
  }
}
```

> 注意：这种"子重新声明"虽然啰嗦，但语义明确。或者**更简单的替代**：子配置不设 `baseUrl`，改用相对 paths——但 TS 不允许 paths 不基于 baseUrl。所以重声明是正解。
>
> **最简方案**：既然实际靠 pnpm symlink + exports 工作，可以**从 base 删除 paths**，承认它没用。子配置的 `@/*`、`~/*` 保留（这些是真别名，admin 内部用）。这样消除"摆设 paths"的混淆。**推荐这个方案**（最干净）。

**决策**：推荐**从 base 删除 `paths`**（最简），理由：
1. 实际解析靠 pnpm symlink + exports，paths 是摆设
2. 删除后无歧义，新人不会误以为 paths 在工作
3. 若未来真需要 bare import，再按 §2.2 的"base 加 baseUrl + paths"方案重新加

#### 2.3 消除跨包 .d.ts reach

**目标**：把 `packages/shared/src/types/*.d.ts` 从 ambient 全局转成显式模块，消费者用 `import type` 而非跨包 include。

**步骤**：

**Step 1**：逐个改造 `packages/shared/src/types/` 下 7 个 `.d.ts`：

以 `deep-ref.d.ts` 为例：

```ts
// 改造前（ambient 全局）
type DeepKeyOf<T> = ...
type DeepKeyOfTwo<T> = ...
```

```ts
// 改造后（显式模块）
export type DeepKeyOf<T> = ...
export type DeepKeyOfTwo<T> = ...
```

7 个文件清单：
- `deep-ref.d.ts`（1981 B）— `DeepKeyOf`、`DeepKeyOfTwo`
- `object-key.d.ts`（693 B）— 对象键类型
- `storage.d.ts`（1128 B）— 存储相关
- `universal.d.ts`（220 B）— `Recordable`、`ValueOf` 等通用类型
- `vite.d.ts`（306 B）— `ViteEnv` 等
- `vue-runtime.d.ts`（132 B）— Vue 运行时类型
- `vue.d.ts`（45 B）— Vue 类型

> ⚠️ 注意：部分 `.d.ts` 可能是 `declare global` 形式（如 `vue.d.ts` 可能扩展 Vue 类型）。`declare global` 不能简单加 `export`——需要重写为模块扩充（`declare module 'vue' { ... }`）。改造时逐个检查。

**Step 2**：消费点改为 `import type`：

```ts
// 改造前（依赖 ambient 全局，无需 import）
const x: DeepKeyOf<SomeType> = ...
```

```ts
// 改造后
import type { DeepKeyOf } from '@walnut/shared/types/deep-ref'
const x: DeepKeyOf<SomeType> = ...
```

消费点散布在 `apps/admin/src`、`packages/axios/src`、`packages/core/src`——需要 grep 每个 ambient 类型名，逐一加 import。

**Step 3**：移除 tsconfig 的跨包 include：

```jsonc
// apps/admin/tsconfig.json
"include": [
  "src/**/*.ts", "src/**/*.d.ts", "src/**/*.tsx", "src/**/*.vue",
  "types/*.d.ts", "build/**/*.ts", "*.ts"
  // 删除： "../../packages/shared/src/types/*.d.ts"
]

// packages/axios/tsconfig.json, packages/core/tsconfig.json
// 同样删除 "../shared/src/types/*.d.ts"
```

**Step 4**：在 `packages/shared/package.json` 的 `exports` 补 types 子路径（如果需要）：

当前 `exports` 是 `{ ".": "./src/index.ts", "./*": "./src/*.ts" }`，已经能解析 `@walnut/shared/types/deep-ref` → `./src/types/deep-ref.ts`。但 `.d.ts` 扩展名可能要显式映射。测试确认。

#### 2.4 补 ui/ai 的 exports（若 Phase 3 不删）

如果 Phase 3 删除 ui/ai，本节跳过。如果保留，给两个 stub 包加 exports 与其他包一致：

```json
// packages/ui/package.json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  }
}
```

### 不动的部分

- `apps/server/tsconfig.json` 的所有 paths（Phase 1 已处理）
- `tsconfig.json`（根工具配置，独立，无问题）
- 各 `apps/server/libs/*/tsconfig.lib.json`（无 paths，无问题）

### 验证

```bash
# 1. 前端类型检查
pnpm --filter @walnut/admin types:check
pnpm --filter @walnut/docs types:check   # echo skipped，但跑一下确认无报错
pnpm --filter @walnut/shared types:check
pnpm --filter @walnut/axios types:check
pnpm --filter @walnut/core types:check

# 2. 确认 ambient 类型已转模块（不应有 declare global 残留，除非是合理的模块扩充）
grep -rn "declare global" packages/shared/src/types/

# 3. 前端 dev 启动（验证 exports + import type 工作）
pnpm --filter @walnut/admin dev
# 浏览器打开，确认无 "Cannot find name 'Recordable'" 类错误

# 4. 前端 build
pnpm --filter @walnut/admin build
```

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| ambient 转 module 时漏改某个消费点，导致 "Cannot find name" | grep 每个类型名，逐一确认有 import |
| `declare global` 误转 `export` 导致 Vue 模块扩充失效 | 逐个检查 `.d.ts`，区分"全局 ambient"和"模块扩充" |
| bare import 仍有人写（虽然实际没有） | 改造后 base 无 paths，bare import 会 TS 报错——这正是期望行为（强制 subpath） |

### 提交信息

```
chore: consolidate tsconfig, remove orphan base, fix cross-package type reach

- Remove unused tsconfig.base.node.json (zero consumers)
- Remove vestigial paths from tsconfig.base.json (resolution was broken
  by baseUrl override; actual resolution via pnpm symlink + exports)
- Convert packages/shared/src/types/*.d.ts from ambient globals to
  explicit modules; consumers now use `import type` instead of
  cross-package relative includes
- Remove ../../packages/shared/src/types/*.d.ts includes from
  admin/axios/core tsconfigs

Resolves issues #5, #6, #7.
```

---

## Phase 3：空壳包处置

### 目标
删除 `packages/ui` 和 `packages/ai`（零消费者、零源码、纯 stub）。

### 动机
解决问题 #4。详见 [02-workspace-layout.md](./02-workspace-layout.md) §3.4/3.5。

### 改动清单

#### 3.1 删除两个包目录

```bash
rm -rf packages/ui
rm -rf packages/ai
```

`pnpm-workspace.yaml` 的 `packages/*` glob 会自动不再匹配这两个目录。无需改 workspace 声明。

#### 3.2 从 admin 移除依赖声明

**文件**：`apps/admin/package.json`

删除：

```json
"@walnut/ai": "workspace:*",
"@walnut/ui": "workspace:*",
```

#### 3.3 从 tsconfig.base.json 移除 paths（若 Phase 2 保留了）

如果 Phase 2 采用了"保留 paths 但加 baseUrl"方案，这里要删 `@walnut/ui` 和 `@walnut/ai` 的映射。如果 Phase 2 采用了"删除 paths"方案（推荐），本节跳过。

#### 3.4 重新安装依赖

```bash
pnpm install
```

这会更新 `pnpm-lock.yaml`，移除 ui/ai 的依赖树。

### 不动的部分

- `packages/shared`、`packages/axios`、`packages/core` — 真实包，保留
- `apps/admin/src` 下任何文件 — 已确认零 `@walnut/ui`/`@walnut/ai` import，无需改

### 验证

```bash
# 1. 确认包已删除
ls packages/
# 期望：只有 ai axios core shared（无 ui ai——顺序按字母）

# 2. 确认 admin 不再引用
grep -rn "@walnut/\(ui\|ai\)" apps/admin/src
# 期望：零输出

# 3. 类型检查 + 构建
pnpm --filter @walnut/admin types:check
pnpm --filter @walnut/admin build

# 4. install 无警告
pnpm install
# 期望：无 "unmet peer dependency" 或 "workspace package not found" 警告
```

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 有遗漏的 ui/ai import（虽然 grep 说零） | 验证步骤 §2 的 grep + types:check 兜底 |
| 未来想恢复 ui/ai 包 | git 历史保留，可随时 `git revert` 此 commit 或从历史 cherry-pick |

### 提交信息

```
refactor: remove empty @walnut/ui and @walnut/ai stub packages

Both packages contained only placeholder index.ts files ("Source files
will be populated in Phase 5/6") with zero consumers (grep of
apps/admin/src returned 0 imports for both). The Phase 2 extraction
described in docs/monorepo.md was never executed; actual UI components
live in apps/admin/src/components/ and AI chat code in
apps/admin/src/views/demo/ai-chat/.

Removes dead workspace: declarations from apps/admin/package.json.
If shared UI/AI packages are needed in the future, they can be
recreated from scratch with proper boundaries.
```

---

## Phase 4：契约包 `@walnut/contract`

### 目标
引入 `packages/contract`，承载前后端共享的纯类型 + 纯常量，消除 6 处重复维护。

### 动机
解决问题 #2。这是全栈 monorepo 的最大红利——目前前后端零契约共享，API 字段变更时前端无编译期保护。

### 模块策略论证（关键）

**唯一可行路径：type-only + 纯 `as const` 常量，零运行时类、零装饰器依赖。**

**为什么不能共享后端 DTO 类**：

后端 DTO 层有 44 个 `*.dto.ts` 文件，其中 **25/41（61%）** 直接 extend 或 `IntersectionType`/`RealPickType` 一个 Mongoose `*Model` schema 类。例如：

```ts
// apps/server/apps/api/src/modules/system/user/dto/user.dto.ts
export class SysUserDTO extends IntersectionType(SysUserModel, ...) { ... }
```

这些 `*Model` 类带 `@Schema()` + `@Prop()` 装饰器（`@nestjs/mongoose`），且 `SchemaFactory.createForClass(...)` 在模块加载时执行。它们是**运行时 Mongoose 工件**，不是可移植类型。

此外，后端用自定义装饰器 `@walnut/decorators/field*`（`WalnutAdminDecoratorFieldString` 等），内部 emit `@IsString`/`@Expose`/`@Type`/swagger 元数据。`class-transformer` 的 `plainToInstance` 在 `list.dto.ts` 模块加载时调用。

**如果前端 import 这些类**，会把 `class-validator` + `class-transformer` + `@walnut/decorators` + `reflect-metadata` + `mongoose`（传递依赖）拖进浏览器 bundle。这是前端明确不想要的开销。

**type-only 的好处**：
- 接口和 `type` 别名在编译时擦除 → 零运行时、零装饰器、零依赖
- `as const` 对象是纯字面量 → 无 class-validator、无 mongoose，两端通用，前端 tree-shake 友好
- 后端**保留**自己的装饰 `*DTO`/`*Model` 类，只从 contract 导入**形状**和**常量**作基础

**模块系统兼容性**：
- 前端：ESM + `moduleResolution: bundler` — 支持 package `exports` 条件映射
- 后端：CJS + `moduleResolution: node10` — **只认 `main`/`types`，不认 `exports` conditions**

所以 contract 包必须用**最简单的 exports**（与 shared 一致）：

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  }
}
```

raw `.ts` 源码 + 简单 wildcard 映射，两端都能解析（前端靠 Vite，后端靠 SWC `jsc.paths` + tsc `paths`）。

### MVP 内容（按优先级）

基于已确认的 6 处重复（详见 [07-known-issues.md](./07-known-issues.md) 问题 #2）：

#### 内容 1：Response/Error codes（最高优先）

**权威源**：`apps/server/libs/const/src/app/responseCode.ts` → `WalnutAdminConstAppResponseCode`（~70 codes）

**迁移动作**：
1. 把整个 `WalnutAdminConstAppResponseCode` 对象搬到 `packages/contract/src/response-code.ts`
2. 后端 `libs/const/src/app/responseCode.ts` 改为 re-export：`export { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'`
3. 前端 `packages/axios/src/constant.ts`：
   - 删除 `BusinessCodeConst`（重复子集）
   - 删除 `notAllowedErrorCodeMap`（硬编码数字）
   - 改为从 contract 导入，前端需要的子集用 `ValueOf<WalnutAdminConstAppResponseCode>` 或局部 re-export
4. 修复已漂移的命名（如 `CAPJS_TOKEN_INTERACTION_REQUIRED` vs `UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED`）——以后端权威名为准

#### 内容 2：响应信封

**合并**：
- 前端 `packages/axios/src/types.ts` → `BaseResponse<T> { code, msg, data, meta? }`
- 后端 `apps/server/libs/types/src/walnut-admin/response.d.ts` → `IWalnutAdminResponseBase<T> { data, code?, msg?, requestId, meta?, _devMsg? }`

**迁移动作**：
1. 在 `packages/contract/src/response.ts` 定义权威：
   ```ts
   export interface ResponseBase<T = any> {
     code: number
     msg: string
     data: T
     requestId?: string
     meta?: Record<string, unknown>
     _devMsg?: string
   }
   ```
2. 前端 `packages/axios/src/types.ts`：`export type BaseResponse<T = any> = ResponseBase<T>` （别名兼容）
3. 后端 `libs/types/src/walnut-admin/response.d.ts`：改为 `import '@walnut/contract/response'`，`IWalnutAdminResponseBase` 改为 alias

#### 内容 3：分页契约

**搬迁**：`packages/axios/src/types.ts` 的 `BaseListParams<T>`、`BaseListResponse<T>`、`SortOrder` → `packages/contract/src/pagination.ts`

后端 `apps/api/src/common/dto/list.dto.ts` 的运行时类（`CreateWalnutAdminRequestListDTO` 等）保留，但它们的**类型签名**从 contract 导入基础形状。

#### 内容 4：共享枚举

**搬迁 6 组枚举**（前后端字节级重复）：

| 枚举 | 前端位置 | 后端位置 | contract 文件 |
|------|----------|----------|--------------|
| 菜单类型 | `apps/admin/src/const/menu.ts` `AppConstMenuType` | `apps/api/src/modules/system/menu/schema/menu.schema.ts` `SysMenuTypeConst` | `menu.ts` |
| 菜单内外链 | `AppConstMenuTernal` | `SysMenuTernalConst` | `menu.ts` |
| 缓存键策略 | `AppConstCacheKeyStrategy` | `SysMenuCacheKeyStrategyConst` | `menu.ts` |
| 角色名 | `apps/admin/src/const/app.ts` `AppConstRoles` | `libs/const/src/role/index.ts` `WalnutAdminConstRole` | `role.ts` |
| 角色模式 | `apps/admin/src/api/models.d.ts` 内联 `'switchable'\|'combinable'` | `WalnutAdminConstRoleMode` | `role.ts` |
| 语言 | `AppConstLocale` | `WalnutAdminConstAppLanguage` | `i18n.ts` |
| HTTP 头 | `AppConstRequestHeaders` | `WalnutAdminConstAppHeaders` | `http.ts`（注意大小写约定差异，需统一） |

**迁移动作**：
1. 在 contract 定义权威 `as const` 对象
2. 前端删除重复，改为 `import { MenuType } from '@walnut/contract/menu'`
3. 后端删除重复，改为 re-export 或直接 import

#### 内容 5：API 路径常量

前端 `apps/admin/src/api/*.ts` 里散布的内联 `as const` 对象（如 `systemUser`、`authOpaque` 等）。

**迁移动作**：抽取到 `packages/contract/src/routes/{auth,system,app}.ts`，前后端共用（后端用于路由文档生成、前端用于请求）。

> 这部分工作量较大，可作为 MVP 的 stretch goal。

#### 内容 6：Token payload 类型

**搬迁**：`apps/server/libs/types/src/walnut-admin/token.d.ts` 的 `IWalnutAdminAccessTokenPayload` / `IWalnutAdminRefreshTokenPayload` → `packages/contract/src/token.ts`

**好处**：前端终于能给 JWT 解码加类型（目前用 `any`）。

### 不搬迁的（v2 或不搬）

- **`IModels.*` 数据模型接口**（`apps/admin/src/api/models.d.ts`）：后端 DTO 61% 焊死在 Mongoose schema，无法直接共享。要共享需后端停止从 `*Model` 派生 DTO，或维护平行 interface 集——独立大工程，不在本次范围。
- **后端 `libs/const/decorator/*`**（7 个文件）：NestJS 元数据键，前端用不到。
- **后端 `libs/types/walnut-admin/express.d.ts`**：扩展 Express Request/Response，浏览器无意义。
- **后端 `libs/types/process.d.ts`**：扩展 `NodeJS.ProcessEnv`，前端用 Vite 的 `import.meta.env`。

### 落地步骤

#### Step 1：创建包骨架

```bash
mkdir -p packages/contract/src
```

`packages/contract/package.json`：

```json
{
  "name": "@walnut/contract",
  "type": "module",
  "version": "0.0.1",
  "private": true,
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*.ts"
  },
  "scripts": {
    "build": "echo 'contract: pure source, no build needed'",
    "types:check": "tsc --noEmit",
    "lint": "eslint src --concurrency=auto",
    "lint:fix": "eslint src --fix --concurrency=auto"
  },
  "dependencies": {
    "easy-fns-ts": "catalog:"
  }
}
```

> `easy-fns-ts` 是两端都已依赖的 `ValueOf` 工具库，作为 contract 唯一 dep。

`packages/contract/tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": "."
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

`packages/contract/src/index.ts`（barrel，可空或聚合 re-export）：

```ts
// @walnut/contract — shared types and constants for frontend + backend
// Subpath imports preferred: @walnut/contract/<module>
export {}
```

#### Step 2：注册 workspace

`pnpm-workspace.yaml` 的 `packages/*` glob 自动匹配，无需改。

#### Step 3：前端 tsconfig 注册 path

如果 Phase 2 保留了 base paths，在 `tsconfig.base.json` 加：

```json
"@walnut/contract": ["./packages/contract/src"]
```

如果 Phase 2 删除了 paths（推荐），跳过——靠 pnpm symlink + exports。

#### Step 4：后端 tsconfig 注册 path

`apps/server/tsconfig.json` 的 `paths` 块加：

```jsonc
"@walnut/contract":     ["../../packages/contract/src"],
"@walnut/contract/*":   ["../../packages/contract/src/*"]
```

**同时更新 3 个 SWC 配置**（与 Phase 1 同理）：
- `apps/server/infra/swc/dev.swcrc` 的 `jsc.paths`
- `apps/server/infra/swc/prod.swcrc`
- `apps/server/infra/swc/stage.swcrc`

> 注意相对路径：从 `apps/server/` 到 `packages/contract/` 是 `../../packages/contract/`。

#### Step 5：admin 加依赖

`apps/admin/package.json`：

```json
"@walnut/contract": "workspace:*"
```

后端**不加** workspace 依赖（后端用 path 别名解析，不走 pnpm workspace 机制）。

#### Step 6：逐个搬迁 MVP 内容

按优先级 1-6 逐个搬迁，每搬一个跑一次两端 types:check：

```bash
pnpm --filter @walnut/admin types:check
pnpm --filter @walnut/server types:check
```

### 不动的部分

- 后端 `*Model` schema 类、`*DTO` 运行时类（保留装饰器）
- 后端 `libs/const/decorator/*`（NestJS 专用）
- `IModels.*` 数据模型（v2）
- 前端 UI 类型（RouteRecordRaw、Tab.Item 等）

### 验证

```bash
# 1. 两端类型检查
pnpm --filter @walnut/contract types:check
pnpm --filter @walnut/admin types:check
pnpm --filter @walnut/server types:check

# 2. 两端构建
pnpm --filter @walnut/admin build
pnpm --filter @walnut/server build

# 3. 两端测试
pnpm --filter @walnut/server test

# 4. 确认无重复定义
# 响应码应只在 contract 定义
grep -rn "WalnutAdminConstAppResponseCode" apps/ packages/ | grep -v "from '@walnut/contract"
# 期望：前端无独立定义，后端 re-export 或直接 import
```

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| 后端 node10 resolution 不认 exports conditions | 用最简 exports（无 conditions），raw .ts 源 + wildcard，已验证 shared 同模式工作 |
| 命名漂移修复引入 breaking change（前端用旧名） | 逐个迁移，每改一个跑 types:check；保留 alias 兼容（`export { New as Old }`）过渡 |
| 后端 CJS 导入 ESM 包的模块系统冲突 | contract 是 type-only + `as const`，编译后 CJS require 拿到的是普通对象/类型擦除，无实际模块系统冲突 |
| 工作量超预期 | MVP 可分多次提交，优先级 1-3 是核心（响应码/信封/分页），4-6 可后续 |

### 提交信息

```
feat: introduce @walnut/contract package for shared types and constants

Resolve issue #2 (zero contract sharing between frontend and backend).
Currently 6 categories of types/constants are duplicated across
apps/admin and apps/server, with naming drift already occurring.

@walnut/contract is a type-only + as-const package (zero runtime
classes, zero decorator deps) consumed by both frontend (via pnpm
workspace) and backend (via tsconfig path alias). Module strategy is
identical to @walnut/shared: raw .ts source, no build step.

MVP contents:
- Response/error codes (consolidates WalnutAdminConstAppResponseCode
  + BusinessCodeConst + notAllowedErrorCodeMap)
- Response envelope (ResponseBase<T>)
- Pagination contract (BaseListParams, BaseListResponse, SortOrder)
- Shared enums (menu type/ternal/cacheKeyStrategy, roles, languages)
- Token payload types

v2 (not in this PR): IModels.* data-model interfaces — requires
backend to decouple DTOs from Mongoose *Model schema classes (61% of
DTOs currently extend schema classes directly).
```

---

## Phase 5：CI/CD 修复

### 目标
解决问题 #3（CI 坏掉）、#8（dev 脚本）、#12（catalog 不在 globalDeps）。

### 改动清单

#### 5.1 新增 PR CI workflow

**新建**：`.github/workflows/ci.yml`

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        node-version: [24]
    steps:
      - uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11

      - name: Setup Node.js ${{ matrix.node-version }}
        uses: actions/setup-node@v4
        with:
          node-version: ${{ matrix.node-version }}
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Lint
        run: pnpm lint

      - name: Type check
        run: pnpm types:check

      - name: Build
        run: pnpm build
        env:
          NODE_OPTIONS: --max-old-space-size=8192

      - name: Test
        run: pnpm test
        continue-on-error: true   # 初期可选，直到测试稳定
```

> `continue-on-error: true` 是过渡策略——当前只有 server 有测试，且测试可能依赖 MongoDB/Redis（CI 里跑不通）。稳定后移除。

#### 5.2 turbo.json 加 test task

**修改**：`turbo.json`，在 `tasks` 块加：

```json
"test": {
  "dependsOn": [],
  "inputs": ["src/**", "test/**", "vitest.config.*", "tsconfig.json", "package.json"],
  "outputs": ["coverage/**"],
  "cache": true
}
```

#### 5.3 turbo.json 补 globalDependencies

**修改**：`turbo.json`：

```json
"globalDependencies": ["tsconfig.base.json", "tsconfig.json", "eslint.config.mjs", "pnpm-workspace.yaml"]
```

加 `pnpm-workspace.yaml`（catalog 改动触发缓存失效）。

#### 5.4 修复 deploy.yml

**当前问题**：`.github/workflows/deploy.yml` 用 SCP 传输源码 + 远程 `pnpm install --prod`，对 monorepo 根 lockfile 坏掉（远程 install 会拉全 workspace 包，`--prod` 与 workspace 冲突）。

**推荐方案**：`pnpm deploy --filter`

`pnpm deploy` 会在临时目录产出一个**精简的、可独立部署的包**（只含该包及其依赖，剥离 workspace 结构）。

修改 `deploy.yml` 的 build 步骤：

```yaml
- name: Build deploy artifact
  run: |
    # 在临时目录产出可部署的 server 包
    pnpm --filter=@walnut/server deploy --prod --legacy ./deploy-artifact
    # 打包
    tar -czf server.tar.gz -C ./deploy-artifact .
```

然后 SCP `server.tar.gz` 到远程，解压后直接 `node main.js`（无需远程 install）。

**替代方案**：Docker（更彻底，但需写 Dockerfile + 改部署流程）。

> `migration-guide/09-known-issues.md` Issue #5 和 deploy.yml 内的 `TODO: monorepo 适配` 注释记录了三个候选方案：(1) Docker，(2) `pnpm deploy --filter` prune，(3) packaged deploy artifact。推荐 (2) 作为最小改动。

#### 5.5 修复根 dev 脚本

**当前**：`"dev": "turbo dev"` 同时启动三 app。

**方案 A（推荐，最小改动）**：改默认为 admin：

```json
"dev": "turbo dev --filter=@walnut/admin",
"dev:all": "turbo dev"
```

**方案 B（加确认）**：写个脚本询问。过度工程，不推荐。

**方案 C（文档警告）**：不改脚本，在 README 强警告。弱方案。

### 不动的部分

- `release.yml`（tag 触发的 Release 创建，工作正常）
- 各 app 内部的 scripts

### 验证

```bash
# 1. turbo test task 工作
pnpm test
# 期望：跑 server 的 vitest（其他 app 无 test script 会跳过）

# 2. CI workflow 语法
# 推到 PR 分支，观察 GitHub Actions 运行
# 或本地用 act 验证（可选）

# 3. deploy artifact（手动触发 deploy.yml）
# 确认 server.tar.gz 产出，远程能 node main.js 启动
```

### 风险与缓解

| 风险 | 缓解 |
|------|------|
| CI 跑 test 失败（server 测试需 MongoDB） | 初期 `continue-on-error: true`，或加 services.mongodb 到 CI job |
| `pnpm deploy --filter` 产出缺失依赖 | 本地先 `pnpm --filter=@walnut/server deploy --prod ./test-artifact` 验证，确认 node main.js 能起 |
| 改 `dev` 默认行为破坏现有工作流 | 保留 `dev:all` 别名，文档说明 |

### 提交信息

```
ci: add PR workflow, turbo test task, fix monorepo deploy

- Add .github/workflows/ci.yml: lint + types:check + build + test on
  PR/push to main (resolves issue #3)
- Add `test` task to turbo.json (was missing despite server having
  vitest configured)
- Add pnpm-workspace.yaml to turbo globalDependencies (catalog changes
  now invalidate cache, resolves issue #12)
- Fix deploy.yml: replace broken SCP + remote pnpm install --prod with
  `pnpm deploy --filter` to produce a pruned deploy artifact (resolves
  the TODO: monorepo 适配 markers in deploy.yml)
- Change root `dev` to default to admin only (resolves issue #8);
  `dev:all` preserves the old behavior of starting all three apps
```

---

## 跨 Phase 的通用验证清单

每个 Phase 完成后，跑这个清单确认无回归：

```bash
# 1. 全仓库类型检查
pnpm types:check

# 2. 全仓库 lint
pnpm lint

# 3. 全仓库构建（较慢，可选）
NODE_OPTIONS=--max-old-space-size=8192 pnpm build

# 4. 测试（Phase 5 后）
pnpm test

# 5. 前端 dev 启动（手动验证）
pnpm dev:admin
# 浏览器打开 localhost:3100，登录，跑一遍核心流程

# 6. 后端 dev 启动（需 MongoDB+Redis）
pnpm dev:server
# 确认 API 响应正常
```

---

## 不改的部分（明确边界）

为避免范围蔓延，本次 5 个 Phase **不做**以下事情：

1. **不引入 TypeScript Project References / composite** —— 已在 [05-tsconfig-strategy.md](./05-tsconfig-strategy.md) §4 论证不适用
2. **不把后端 9 个 libs 升级为真 workspace 包** —— CJS + SWC + NestJS-CLI 构建链大改风险高，收益低（详见 [03-package-boundaries.md](./03-package-boundaries.md) §4）
3. **不搬移前端业务代码**（Pinia stores、router、views 等）—— 当前 packages 职责清晰
4. **不动 `IModels.*` ↔ Mongoose schema 的契约共享** —— v2 工程，需后端 DTO 重构
5. **不动任何业务逻辑代码** —— 仅架构/工具链/边界
6. **不重写 README/CLAUDE/AGENTS** —— 文档重写归到未来 Phase 0（文档归档）
7. **不归档 `docs/monorepo.md` 和 `migration-guide/`** —— 同上
8. **不加 commitlint** —— 可选改进，非阻塞
9. **不清理 `apps/server`/`apps/docs` 的 standalone 残留**（自带 CLAUDE.md、version.json 等）—— 未来清理

---

## 完成后的预期状态

5 个 Phase 全部完成后，仓库应达到：

| 维度 | 当前 | 完成后 |
|------|------|--------|
| 命名空间 | `@walnut` 双重定义 | `@walnut`（前端）+ `@walnut-server`（后端）+ `@walnut/contract`（共享），零重叠 |
| 契约共享 | 零，6 处重复 | `@walnut/contract` 统一 6 类契约 |
| 空壳包 | ui/ai 占位 | 删除，只留真实包 |
| tsconfig | 3 个缺陷 | 修复，无孤儿、paths 语义清晰、无跨包 reach |
| CI | 坏掉，无 PR 检查 | PR CI + test task + 可部署 artifact |
| 文档 | docs/monorepo.md 过时 | docs/architecture/ 权威（已随本次完成）|

**剩余的未来工作**（非阻塞）：
- 文档归档（monorepo.md、migration-guide/）
- 重写 AGENTS.md
- 清理 apps/server、apps/docs standalone 残留
- 加 commitlint
- IModels.* 契约共享（v2 大工程）
- 安全核查 deploy.config.cjs

---

## 下一步

文档已全部完成。当你（或额度重置后的 AI）准备动手时：
1. 重读 [07-known-issues.md](./07-known-issues.md) 确认问题仍在
2. 按 Phase 1 → 5 顺序执行
3. 每个 Phase 完成后跑「跨 Phase 通用验证清单」
4. 数据可能已过期（文档采集于 2026-07-26），执行前建议重新 grep 核对关键数字
