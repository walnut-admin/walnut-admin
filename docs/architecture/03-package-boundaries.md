# 03 · 依赖方向与命名空间策略

> 本文件讨论仓库最严重的底层架构隐患：`@walnut` 命名空间的双重定义。

---

## 1. 单向依赖规则

仓库的包依赖方向**严格单向向下**（实测，见 [01-overview.md](./01-overview.md) §4）：

```
apps/admin ──→ packages/{ai, axios, core, shared, ui}
packages/ai ──→ packages/{ui, core, axios, shared}
packages/ui ──→ packages/{core, shared}
packages/core ──→ packages/shared
packages/axios ──→ packages/shared
packages/shared ──→ （零依赖，最底层）
```

**规则**：
- packages 之间不能循环依赖
- packages 不能 import apps 的代码（packages 是被消费方，不知道消费者是谁）
- apps/server 和 apps/docs **不参与** packages 依赖图（它们零 workspace 依赖）

这条规则目前**被严格遵守**，没有违规。问题不在依赖方向，而在命名空间。

---

## 2. 核心问题：`@walnut` 命名空间双重定义

### 2.1 现象

仓库里存在**两组**都以 `@walnut` 为 scope 的"包"，但它们的本质完全不同：

| 组 | 成员 | 本质 | 解析机制 | 定义位置 |
|----|------|------|----------|----------|
| **前端 workspace 包** | `@walnut/shared`、`@walnut/axios`、`@walnut/core`、`@walnut/ui`、`@walnut/ai` | 真包（有 package.json、被 pnpm install） | pnpm workspace symlink + package `exports` | `packages/*/package.json` 的 `name` 字段 |
| **后端 path 别名 lib** | `@walnut/config`、`@walnut/const`、`@walnut/context`、`@walnut/db`、`@walnut/decorators`、`@walnut/exceptions`、`@walnut/pipes`、`@walnut/types`、`@walnut/utils` | **假包**（无独立 package.json 作为可发布单元，本质是源码目录） | tsconfig `paths` 别名 + SWC `jsc.paths` | `apps/server/tsconfig.json` 的 `paths` 块 |

### 2.2 为什么"目前不冲突"

当前两组**名字不重叠**：
- 前端用：`shared`、`axios`、`core`、`ui`、`ai`
- 后端用：`config`、`const`、`context`、`db`、`decorators`、`exceptions`、`pipes`、`types`、`utils`

且解析机制隔离：
- `apps/admin/tsconfig.json` extends 根 `tsconfig.base.json`，其中 `paths` 只映射前端的 5 个名字
- `apps/server/tsconfig.json` **不 extends 任何根 base**，自包含，`paths` 只映射后端的 9 个名字

所以今天 `import { foo } from '@walnut/shared'` 在前端解析到 `packages/shared/src`，在后端根本解析不到（后端没这个 path，会报错）——两者井水不犯河水。

### 2.3 为什么这是定时炸弹

**任何未来的人在前端加一个 `@walnut/utils` 包**（比如抽一个通用工具包，名字很自然），就会同时存在于：
- `packages/utils/package.json` 的 `name: "@walnut/utils"`（前端 workspace 包）
- `apps/server/tsconfig.json` 的 `"@walnut/utils": ["./libs/utils/src"]`（后端 path 别名，已存在！）

这时：
- 后端的 `import { xxx } from '@walnut/utils'` 仍然解析到 `apps/server/libs/utils/src`（因为后端 tsconfig 的 paths 指向那里，优先级高于 node_modules）——**表面上不报错，但语义错了**
- 如果后端某天 extends 了根 base（比如未来重构 tsconfig 时），paths 会冲突，行为不可预测
- pnpm 的依赖解析和 tsc 的 paths 解析可能给出**不同结果**，导致开发态和构建态行为不一致

更隐蔽的是：即使没有直接命名碰撞，**同一个 `@walnut` 前缀承载两种语义**（"前端真包" vs "后端别名"）会让所有看到 `@walnut/xxx` 的人无法立刻判断它是什么——必须查配置才知道。这是认知负担，也是 bug 温床。

### 2.4 CLAUDE.md 的辩护为何站不住

根 `CLAUDE.md` 第 80-88 行明确把这种共存当作"设计"来辩护：

> "There is NO name collision — the two `@walnut/*` scopes resolve via different mechanisms and have no overlapping package names."

这个辩护的漏洞：
1. "今天不重叠"不等于"未来不重叠"。后端已经有 `@walnut/utils`、`@walnut/types` 这种**极度通用**的名字，前端抽包时撞名概率极高。
2. "解析机制不同"恰恰是问题——两种解析机制（pnpm symlink vs tsconfig paths）在同一仓库共存，没有 ESLint 规则或工具守护，完全靠人肉记忆。
3. 这种"靠巧合工作"的设计在 monorepo 里是反模式。业界共识（Turbo 官方、Nx 官方）是：**一个 scope 一种解析机制**。

---

## 3. 目标命名空间策略

### 3.1 三段式 scope 划分

```
@walnut/*         → 前端 workspace 包（保持不变）
                    shared, axios, core, (ui 删除), (ai 删除), contract(新增)

@walnut-server/*  → 后端 path 别名 lib（重命名）
                    config, const, context, db, decorators, exceptions, pipes, types, utils

@walnut/contract  → 前后端共享契约包（新增，属于前端 scope 但被两端消费）
                    纯类型 + 纯常量，零运行时
```

### 3.2 为什么是 `@walnut-server` 而不是其他方案

| 方案 | 优点 | 缺点 | 采纳？ |
|------|------|------|--------|
| **A. 后端改 `@walnut-server/*`**（推荐） | 改动集中（只动后端）、前端零改动、语义清晰（`-server` 后缀一眼可辨）、与 npm 惯例一致（如 `@nestjs/cli` vs `@nestjs/testing`） | 后端 388 个源文件要改 import | ✅ |
| B. 前端改 `@walnut-client/*` | 后端零改动 | 前端改动面更大（admin 48+46+17=111 个消费文件）、且前端包是"对外可见"的共享库，改名影响更大 | ❌ |
| C. 后端 libs 升级为真 workspace 包 | 统一了解析机制（全部走 pnpm） | 后端 CJS + SWC + NestJS-CLI 构建链要大改、9 个 lib 的 `tsconfig.lib.json` + `infra/nest/*.json` + `build:libs` 全部重写、风险极高 | ❌ |
| D. 维持现状 + 加 ESLint 护栏 | 改动最小 | 护栏规则难写（要区分"这个 `@walnut/xxx` 该在前端还是后端用"）、隐患仍在 | ❌ |

**方案 A 的额外好处**：后端 package.json 的 `name` 字段本来就是 `@walnut/server`（一个 app 包），现在 lib 也用 `@walnut-server/*`，形成「`@walnut/server` 这个 app 内部的 lib 都是 `@walnut-server/*`」的清晰归属。注意：lib 的 `@walnut-server/*` 是 path 别名，`@walnut/server` 是真包名，**两者不冲突**（一个是 import 路径前缀，一个是 pnpm 包名）。

### 3.3 改名影响的精确范围

> 这是 Phase 1 改造的核心数据，完整执行清单见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 1。

**配置文件（4 个，必须改）**：
1. `apps/server/tsconfig.json` — `paths` 块（21-79 行），9 个 alias × 2 形式（exact + wildcard）= 18 条
2. `apps/server/infra/swc/dev.swcrc` — `jsc.paths` 块（17-37 行）
3. `apps/server/infra/swc/prod.swcrc` — `jsc.paths` 块（16-36 行）
4. `apps/server/infra/swc/stage.swcrc` — `jsc.paths` 块（结构同上）

**源文件（388 个 .ts/.d.ts，必须改）**：

| Alias | 引用文件数 | import 出现次数 | apps/api 下 | libs 下 |
|-------|-----------|----------------|-------------|---------|
| `@walnut/const` | 188 | 292 | 162 | 26 |
| `@walnut/db` | 171 | 172 | 166 | 5 |
| `@walnut/decorators` | 100 | 130 | 99 | 1 |
| `@walnut/utils` | 82 | 97 | 73 | 9 |
| `@walnut/exceptions` | 61 | 84 | 55 | 6 |
| `@walnut/config` | 15 | 17 | 9 | 6 |
| `@walnut/types` | 15 | 11* | 14 | 1 |
| `@walnut/pipes` | 9 | 9* | 4 | 5 |
| `@walnut/context` | 5 | 7 | 3 | 2 |
| **合计** | **388 去重** | **819** | — | — |

`*` types/pipes 的文件数 > 出现数，因为部分文件只在注释里提到 alias（如 `// moved to @walnut/types/...`），不计入实际 import。

**不动的部分（关键，避免误改）**：
- `apps/server/package.json` 的 `"name": "@walnut/server"` — 这是包名本身，不是 lib alias
- `apps/server/infra/nest/{dev,prod,stage}.json` — 用短名（`config`、`db`）和文件系统路径（`libs/config/src`），**不引用 alias**
- `apps/server/package.json` 的 `build:libs` 脚本 — 用短名 `nest build config`
- `apps/server/apps/api/tsconfig.app.json` — 只有相对路径 include，无 alias
- `apps/server/apps/api/vitest.config.ts` — 用 `vite-tsconfig-paths` 自动读 tsconfig，改了 tsconfig 自动生效
- 9 个 `apps/server/libs/*/tsconfig.lib.json` — 无 paths，只 extends + outDir

**可选清理**（不影响功能）：
- ~12 处 `// Note:` 注释提到旧 alias
- 11 个 `apps/server/libs/*/README.md` 里文档化的 alias 路径

---

## 4. 为何不把后端 libs 升级为真 workspace 包（方案 C 的否决理由）

后端这 9 个 lib 当前是「tsconfig path 别名 + NestJS-CLI monorepo + SWC 编译」的组合。如果要把它们变成 pnpm workspace 真包（像前端的 shared/axios/core 那样），需要：

1. **每个 lib 加完整 package.json**（name、version、private、exports、dependencies）——9 个新文件
2. **改 NestJS-CLI 配置**：`infra/nest/*.json` 的 `projects` 块、SWC `filenames` 数组、`build:libs` 脚本全部要适配 workspace 解析
3. **解决 CJS/ESM 冲突**：后端是 `module: commonjs`，前端 packages 是 `module: ESNext`。如果后端 lib 要被前端消费（不太可能，但架构上要考虑），模块系统要统一或加 conditions
4. **改构建产物路径**：当前 `dist/libs/<name>` 是 NestJS-CLI 编译输出，改成 workspace 包后要重新设计产物布局
5. **重写 9 个 `tsconfig.lib.json`**：当前它们 extends `../../tsconfig.json`（server 自包含配置），改成 workspace 包后 extends 链要重做

**收益**：统一了解析机制（全部走 pnpm workspace，告别 path 别名）。

**代价**：改动面极大、风险高、且后端 lib **本来就不需要被前端消费**（它们是 NestJS 专属的装饰器/schema/DI 工具，前端用不了）。

**结论**：方案 C 是"为了统一而统一"，收益不抵代价。保留后端的 path 别名机制，只改 scope（方案 A），是性价比最高的选择。

> 后端 lib 是否值得进一步抽取，`apps/server/docs/lib-extraction-recommendations.md` 有详细分析（13 个 Tier-1 候选可零耦合抽取），但那是后端内部优化，与命名空间问题无关。

---

## 5. `@walnut/contract` 的定位（Phase 4 预告）

引入共享契约包是为了解决**前后端零契约共享**的问题——目前 6 处类型/常量手工双份维护，已经漂移。

**定位**：
- 属于 `@walnut/*` scope（前端 scope），因为它要被前端消费
- 同时被后端消费（后端 tsconfig 加一条 `@walnut/contract` path 指向 `../../packages/contract/src`）
- **纯类型 + 纯 `as const` 常量，零运行时类、零装饰器依赖**
- 模块策略：与 shared 一致，内部包模式，exports 直指 `.ts` 源

**为什么不放到 `@walnut-server` scope**：因为它是**双向消费**的（前端也用），不属于"后端专属"。放 `@walnut/*` 让前端自然 import，后端通过 path 别名也能 import，两端解析到同一份源码。

**为什么不分到独立的 `@walnut-contract` scope**：增加 scope 数量增加认知负担。`@walnut/contract` 与 `@walnut/shared` 同级，语义上"shared 是前端共享，contract 是全栈共享"，清晰够用。

契约包的完整设计、可行性论证、MVP 内容、6 处重复证据，详见 [08-refactor-plan.md](./08-refactor-plan.md) Phase 4。

---

## 6. 总结

| 维度 | 当前状态 | 目标状态 |
|------|----------|----------|
| 前端包 scope | `@walnut/{shared,axios,core,ui,ai}` | `@walnut/{shared,axios,core,contract}`（删 ui/ai，加 contract） |
| 后端 lib scope | `@walnut/{config,const,...}`（path 别名） | `@walnut-server/{config,const,...}`（path 别名，改名） |
| 共享契约 | 无 | `@walnut/contract`（新包，两端消费） |
| 解析机制混用 | 是（pnpm + tsconfig paths 共存于同 scope） | 否（`@walnut/*` 全走 pnpm，`@walnut-server/*` 全走 paths） |
| 命名碰撞风险 | 高（任何前端新包撞后端名就炸） | 零（scope 物理隔离） |

---

## 下一步

- 想看完整问题清单 → [07-known-issues.md](./07-known-issues.md)
- 想动手改名 → [08-refactor-plan.md](./08-refactor-plan.md) Phase 1
- 想了解契约包 → [08-refactor-plan.md](./08-refactor-plan.md) Phase 4
