# package.json & Scripts

## 概述

Walnut Admin 的 `package.json` 遵循一套严格的脚本约定：**每个 workspace 包都有相同的 script 名称，根 scripts 只做委托**。这套约定让 Turborepo 能统一编排所有包的任务。

## 我们做了什么

### 1. 标准化 script 名称

每个包至少包含以下 scripts（名称一致）：

```jsonc
{
  "scripts": {
    "build": "tsc",              // 构建产物
    "dev": "tsc --watch",        // 开发模式
    "clean": "rm -rf dist",      // 清理
    "typecheck": "tsc --noEmit", // 纯类型检查（不产出文件）
    "lint": "eslint src/",       // 代码检查
    "lint:fix": "eslint --fix src/",
    "test": "vitest run",        // 单次测试
    "test:watch": "vitest",      // 持续测试
    "test:coverage": "vitest run --coverage"
  }
}
```

**一致性 > 自由度**。不要有的包叫 `lint`，有的叫 `eslint`——Turbo 需要统一的 task 名来编排。

> 注：以上是**理想约定**，实际并非每个包都齐备——有 `test` 脚本的是 server / contract / utils / client / eslint-config / vite-config / scripts / release（server 的覆盖率脚本叫 `test:cov` 而非 `test:coverage`，utils / client 带 `--passWithNoTests`）；commitlint-config / tsconfig / vitest-config 只有 `lint` / `lint:fix` / `types:check`，没有 `test`（tsconfig 是纯 JSON 预设，`types:check` 只是一句 `echo`）。

### 2. 根 scripts 只做委托，其余命令住命令表

根 `package.json` 只留**一小组**脚本：`dev`、`build`、`lint`、`lint:fix`、`types:check`、`test`、
`prepush`、`setup-env`、`release`，入口本身 `walnut`，以及 `lint:root`。保留的判据（见
[ADR 0029](../adr/0029-command-table-and-entry.md)）：

1. **外部按名字调用它们**：`prepush`（lefthook 的 pre-push）、`setup-env`
   （`.github/actions/decrypt-env`）、`build`（文档站的 netlify 配置）；
2. **人与 agent 都默认存在的命令**：日常开发与门禁的主干（`dev` / `build` / `lint` / `types:check` /
   `test`），以及发版与 env 解密；
3. **turbo 根任务需要的脚本**：`lint:root` 是唯一不是命令入口的一条 —— 根 `turbo.json` 的
   `//#lint:root` 要跑根上同名脚本，删掉它 turbo 会把任务标成 `<NONEXISTENT>`、跑 0 个任务仍退 0。

其余仓库级命令（`lint:*` 门禁、`boundaries`、`db:*`、`images:*`、`clean:all`、`ci:local` …）住在
**一张命令表**里：`tooling/scripts/src/lib/commands.ts`。每项有稳定 id、分组、一句话说明、
「凭什么」，以及执行形态（经 pnpm 的 argv，或入口进程里的自定义函数）：

```bash
pnpm walnut <id>        # 直接执行（id 拼错会报错并列出全部真实 id）
pnpm walnut --list      # 每行一条：id、分组、说明
pnpm walnut --json      # 整张表的机器可读形态（agent 的入口）
pnpm walnut             # 人在终端里：上下键移动、空格勾选、回车执行
```

表里的每条命令值仍然是「一句话委托」（`exec walnut-check-*`、`exec turbo …`；`lint:root` 是
`run lint:root`，委托给根上那条 eslint 脚本），只是绝大多数不再占根 `package.json` 的一行。

```jsonc
// root package.json — 只剩外部契约与日常主干
{
  "scripts": {
    "walnut": "node tooling/scripts/bin/run.ts", // 入口：由 node 直接启动，不登记为 bin
    "dev": "turbo dev --filter=@walnut/admin --filter=@walnut/server",
    "build": "cross-env NODE_OPTIONS=--max-old-space-size=8192 turbo build",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "lint:root": "eslint *.ts *.json *.yaml --concurrency=4", // 根 turbo 的 //#lint:root 任务需要它
    "types:check": "turbo types:check",
    "test": "turbo test",
    "prepush": "walnut-prepush",        // 门禁表在 tooling/scripts/src/ci/prepush.ts
    "setup-env": "walnut-setup-env decrypt",
    "release": "walnut-release"
  }
}
```

根 scripts 里的 `NODE_OPTIONS=` 前缀统一用 `cross-env` 包裹（Windows 兼容）。早期的
`tsx scripts/*.ts` 写法已消失：仓库级脚本拆在 `tooling/scripts/`（通用层 + 一批门禁 / env 的 bin）与
`tooling/release/`（发版编排 + `walnut-release`），根 `scripts/` 目录不存在。**bin 的名字不在这里列**
—— 它们随门禁增删而变（本页曾经抄过一份，很快就烂了），真源是各包 `package.json` 的 `bin` 字段；
「每个 bin 都有人引用、没有孤儿 bin」由 `gate-wiring.test.ts` 机械核对，引用面是**根脚本值 +
命令表 argv** 两处。也没有 `changeset` / `changeset:auto` / `changelog` 脚本——版本意图由
`pnpm change` 写、`pnpm version -r` 消费（见 [发布 & 发版指南](./release.md)）。

> `tsx` 已**完全移出仓库**（不只是根 scripts）：仓内最后一个使用者是 `apps/admin` 的 `predev`（`node build/generate/index.ts`）与 `types:check:log`（`node build/types.ts`），两个脚本改走 Node 24 原生类型剥离后，`tsx` 的 devDependency 与 catalog 条目一起删掉。代价是这条链路要满足 Node ESM 的解析规则：相对导入补全 `.ts` 扩展名、读 JSON 要带 `with { type: 'json' }` 导入属性。2026-11 起 codegen 调用的日志与读写工具搬到了 `@walnut/vite-config/utils`，同一条解析规则跟着包走（见该包 README 的「已知限制」）；`types:check:log` 本身已于 2026-11-24 删除。

> `lint:root` 是 2026-09-23 新增的一节（glob 从 `*.mjs` 改为 `*.ts`）。根级配置（`eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts` / `package.json` / `pnpm-workspace.yaml`）此前**不被任何门禁覆盖**——`pnpm lint` 只跑各包的 `lint` 任务。它现在进 `prepush` 与发版电池，`ci.yml` 的 quality job 也补了一步 `pnpm walnut lint:root`（它不进 turbo 的 affected 图，所以必须显式跑）。

> **所有 `lint` / `lint:fix` 都写死 `--concurrency=4`，别再改回 `auto`**（2026-09-29）。原因是一次实测：在 12 逻辑核的机器上，`auto` 会开 12 个 worker，而 `apps/admin` 的脚本还带 `NODE_OPTIONS=--max-old-space-size=8192` ⇒ 12 × 8 GB 的堆上限落在 64 GB 的机器上，`eslint`（含 `--fix`）会偶发以 `0xC0000005`（ACCESS_VIOLATION）崩溃；`--fix` 崩在中途还会**落下半修复的工作区**。改固定 4 之后同类跑法 5/5 通过，且**并不更慢**：同一个 `apps/admin` 全量 lint 实测 `auto` 28.1s / `4` 26.8s / `6` 28.3s（worker 越多，调度开销越明显，ESLint 自己也会打 `ESLintPoorConcurrencyWarning`）。根因（内存压力）只是合理推断，**没有抓崩溃转储**；同一份判据也写在 `@walnut/eslint-config` 的 `base.ts` 顶部注释里（改 lint 脚本前先看那段）。

**关键规则**：根 scripts 不包含构建逻辑。`turbo build` 会找到所有包的 `build` script 并按拓扑顺序执行。

### 3. 按包类型的差异化

| 包类型 | build | types:check | dev |
|--------|-------|-----------|-----|
| Vue 应用 (`@walnut/admin`) | `vite build` | `vue-tsc --noEmit` | `vite` |
| 文档站 (`@walnut/docs`) | `vitepress build` | `echo skipped` | `vitepress` |
| NestJS (`@walnut/server`) | `nest build`（SWC，按 `infra/nest/*.json`） | `tsc --noEmit` | `nest start api --watch` |
| 平台无关包 (`@walnut/utils`、`@walnut/contract`) | `vite build`（产出 CJS dist；contract 之后还跑 `node scripts/build-barrel.ts`） | `tsc --noEmit` | 无 `dev` 脚本 |
| 源码直消费 (`@walnut/client`、`@walnut/http`、`@walnut/types`) | 不构建（`echo` 占位） | `tsc --noEmit` | 无 `dev` 脚本 |
| 其余工具链包 (`tooling/` 下，`@walnut/tsconfig` 除外) | 无 | `tsc --noEmit` | 无 `dev` 脚本 |
| `@walnut/tsconfig` | 无（纯 JSON 预设） | `echo`（无源码可查） | 无 `dev` 脚本 |

前端构建的特殊性：admin 的 `build` 就是纯 `vite build`（不再含 `vue-tsc`，Vite 构建本身不做类型检查），类型检查由独立的 `types:check` 任务（`vue-tsc --noEmit`）承担。docs 的 `types:check` 是 `echo skipped`（文档站没有需要类型检查的 TS 逻辑）。**没有 `build` 产物的包不是"漏了脚本"**：它们的 `build` 是一句 `echo` 占位，只为让 turbo 的 `build` 任务拓扑（`dependsOn: ["^build"]`）在整图上成立。

### 4. Git Hooks

钩子内容的唯一真源是根 `lefthook.yml`（lefthook，不再是 `simple-git-hooks`，见 [ADR 0018](/content/adr/0018-git-hooks-lefthook)）：

```
pre-commit → pnpm exec lint-staged（ESLint fix on staged files，秒级）
commit-msg → pnpm exec commitlint --edit {1}（提交信息规范检查）
pre-push   → pnpm --silent prepush（单条聚合门禁：跑一张门禁表，并行、每段报耗时）
```

`prepush` 只指向一个 bin：`walnut-prepush`。它跑的是 `tooling/scripts/src/ci/prepush.ts`
里的**一张门禁表** —— 每段带 `why`、**并行执行**、每段报耗时。加一段门禁就是在那个数组里加一项，
不用再在长串里找位置。整表耗时看那段输出自己报（`✅ N 段全部通过（总 Xs）`），**别在本页抄数量**
—— 它随门禁增删而变，抄了必腐烂。

`pre-commit` 只跑 ESLint fix，不做类型检查（太慢，阻塞 commit 体验）；`commit-msg` 由 commitlint 校验提交信息格式；其余的静态检查全部放在 `pre-push`。pre-push 刻意只调**单条命令**，且钩子文件里没有可截断的命令链 —— 清单在跟踪面里的一张表上，改动在 diff 里看得见，完整性由 `prepush.test.ts` 机械拦（它断言表里每一段的首词都能落到真实存在的可执行名字上：保留的根脚本或命令表 id）。

> 注意 `lint:root` 是**命令表**里的一项（`pnpm walnut lint:root`），同时根 `turbo.json` 已存在 `//#lint:root` 任务（`//#` 前缀表示根任务）。因此 `pnpm walnut lint:root` 与 `turbo run lint:root` 都能调用，后者还会命中 turbo 缓存；`lint:root` 不会跟着任何包的 `lint` 跑。

## 没做什么 / 为什么

### 不写 mega-scripts

不在根 package.json 写复杂的 shell 脚本。所有跨包编排由 Turbo 处理，所有仓库级脚本（门禁、env 加解密、发版编排）由 `@walnut/scripts`（`tooling/scripts/`，bin 清单以它 `package.json` 的 `bin` 字段为准）与 `@walnut/release`（`tooling/release/`，bin `walnut-release`）提供。根 scripts 保持"一句话委托"。

### 不用 `concurrently` 编排

`concurrently` 只能并行启动进程，不理解依赖拓扑。`turbo dev` 不仅并行启动，还按依赖顺序执行（先启动被依赖的包，再启动依赖者），避免"依赖还没准备好就请求"的问题。

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [package.json](https://github.com/walnut-admin/walnut-admin/blob/main/package.json) | 根 scripts：只留外部契约与日常主干，全为委托 |
| [tooling/scripts/src/lib/commands.ts](https://github.com/walnut-admin/walnut-admin/blob/main/tooling/scripts/src/lib/commands.ts) | **仓库级命令的唯一真源**（`pnpm walnut` 的数据源：id / 分组 / 说明 / argv） |
| [tooling/scripts/](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/scripts) | `@walnut/scripts`——仓库门禁与 env 工具的 bin 都在这里（**清单看该包 `package.json` 的 `bin` 字段**，本页不抄） |
| [tooling/vitest-config/](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/vitest-config) | `@walnut/vitest-config`——共享 Vitest 预设（无 bin、无 build） |
| [tooling/vite-config/](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/vite-config) | `@walnut/vite-config`——Vite 插件表 / 开发代理 / env schema / 构建期读写（无 bin、无 build） |
| [tooling/release/](https://github.com/walnut-admin/walnut-admin/tree/main/tooling/release) | `@walnut/release`——bin `walnut-release`（根 `pnpm release`） |
| [apps/admin/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/admin/package.json) | 前端 scripts（Vite） |
| [apps/server/package.json](https://github.com/walnut-admin/walnut-admin/blob/main/apps/server/package.json) | 后端 scripts（NestJS CLI + SWC） |
