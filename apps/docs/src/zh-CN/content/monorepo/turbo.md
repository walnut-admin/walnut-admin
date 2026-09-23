# Turbo

## 概述

Walnut Admin 使用 **Turborepo 2.9** 作为任务编排引擎。它负责解决三个核心问题：(1) 按依赖拓扑顺序执行任务；(2) 缓存构建产物避免重复计算；(3) 只对受变更影响的包执行任务。

## 我们做了什么

### 1. 任务拓扑编排

[`turbo.json`](https://github.com/walnut-admin/walnut-admin/blob/main/turbo.json) 定义了 11 个任务：

```jsonc
{
  "tasks": {
    "transit": {
      "dependsOn": ["^transit"],      // ← 传递节点（没有对应脚本）：把上游**源码**串进哈希
      "inputs": ["$TURBO_DEFAULT$", "!**/*.md"]
    },
    "build": {
      "dependsOn": ["^build"],        // ← 关键：先构建所有上游依赖
      "outputs": ["dist/**", ".vitepress/dist/**"],
      "env": ["VITE_*", "MODE"]       // 环境变量影响 → 变更时缓存失效
    },
    "build:stage": {
      "dependsOn": ["^build:stage"],  // admin 侧 vite build --mode stage
      "outputs": ["dist/**", "dist-staging/**", ".vitepress/dist/**"],  // ← staging 落 dist-staging
      "env": ["VITE_*", "MODE"]
    },
    "dev": {
      "dependsOn": ["^build"],       // 先构建上游 CJS 产物（server 运行时 require 依赖）
      "persistent": true,              // 长期运行（dev server）
      "interruptible": true,           // 允许被信号中断（配合 persistent）
      "cache": false                   // 不缓存
    },
    "preview": {
      "dependsOn": ["^build"],       // 与 dev 同构：本地预览生产构建产物
      "persistent": true,
      "interruptible": true,
      "cache": false
    },
    "lint":        { "dependsOn": [], "cache": true },
    "lint:fix":    { "dependsOn": [], "cache": false },
    "types:check": { "dependsOn": ["transit"], "cache": true },  // ← 不挂 ^build，靠 transit 拿上游源码
    "test":        { "dependsOn": ["^build"], "cache": true },
    "clean":       { "dependsOn": [], "cache": false },
    "clean:all":   { "dependsOn": [], "cache": false }
  }
}
```

**`transit` 为什么存在**：本仓 6 个共享包**不构建**（`build` 只是一句 echo），下游读到的是它们的**源码**，
而 `types:check` 原本 `dependsOn: []` ⇒ 改依赖包源码时它**不失效**、直接回放旧的类型结论。
`transit` 是没有脚本的传递节点，让「上游的 inputs」沿依赖图逐级并进本 task 的哈希。
实测与取舍见 [Turbo 缓存边界 §4.2](./turbo-cache-boundary)。

**`dependsOn: ["^build"]`** 是核心设计——`^` 前缀表示"拓扑依赖"：Turbo 会自动计算包的依赖图，先执行被依赖的包的 `build`，再执行依赖者的 `build`。

```
依赖图：contract → utils → client → admin
执行序：contract#build → utils#build → client#build → admin#build
```

**`dev` / `test` 也依赖 `^build`**：后端运行时 `require('@walnut/contract')` 走 `exports.require` → `dist/index.cjs`（见 ADR 0002），而 `dist/` 是 gitignore 的构建产物。fresh clone 后直接 `pnpm dev:server` 若缺这一步会 MODULE_NOT_FOUND——因此 `dev` 与 `test` 都先跑一次 `^build`（Turbo 缓存，通常 <1s）。

**`build:stage` 是独立任务**：`pnpm build:stage` = `turbo build:stage --filter=@walnut/admin`，由 admin 的 `build:stage`（`vite build --mode stage`）脚本承载，替代早期 `turbo build -- -- --mode stage` 的三重 `--` 透传（透传参数会泄漏给图中所有任务，且链路脆弱）。

### 2. 构建缓存

Turbo 对每个 task 做 **content-aware hashing**：hash 源码 + 依赖 + 环境变量 → 如果与上次相同 → 直接复用缓存产物。

```jsonc
"build": {
  "inputs": [
    "$TURBO_DEFAULT$",    // 默认 hash 包内所有文件（git 跟踪 + 未被忽略的未跟踪文件）
    "env-local/**",       // 必须显式写——它被 gitignore，而 Vite 的 envDir 就是它
    "!README.md",         // 排除——README 变更不影响构建
    "!**/*.md",           // 排除——Markdown 变更不影响构建
    "!**/tsconfig.tsbuildinfo"  // 排除——增量编译元数据
  ],
  "outputs": ["dist/**", ".vitepress/dist/**"]  // 声明构建产物位置（用于缓存恢复）
}
```

**效果**：没改过的包 → 200ms 从缓存恢复（vs 重新构建的 10-30s）。"CI 中 cache hit 率通常 > 80%" 是**期望值**——CI workflow（`.github/workflows/ci.yml`）已接入，该指标待实测。

> 🧊 **「改哪个文件会让哪个 task 的缓存失效」的完整实测判据表在
> [Turbo 缓存边界](./turbo-cache-boundary)** —— 包括四条已经修掉的缝
> （`build:stage` 漏产物目录导致**缓存命中却一个文件都不产出**、`types:check` 看不到依赖包源码、
> 解密后的 `env-local` 不进哈希、`@walnut/server` 两条构建流程共用一个 `dist`），
> 以及守这些不变量的门禁 `pnpm lint:turbo-cache`（push 前 + CI + 发版电池三处都跑）。

### 3. 环境变量感知

Turbo 2.x 的 **Strict Environment Mode** 要求显式声明 task 依赖哪些环境变量：

```jsonc
"build": {
  "env": ["VITE_*", "MODE"]     // 这些变量变更 → 缓存失效
}
```

```jsonc
// 运行时可见但**不进哈希**的变量。
// ⚠️ `NODE_ENV` 刻意在这里而不是 `globalEnv`：它必须可见（Turbo 严格模式会剥离未声明的
// 变量，而 NODE_ENV 不在 Turbo 的内置放行名单里），但没有任何 task 的**产物**取决于外部
// 传进来的这个值 —— 各工具链自己会设定它（Vite build 强制 production、vitest 强制 test、
// 后端 build 由脚本 `cross-env` 设定）。放进 globalEnv 的实测代价是「同一份代码换个
// NODE_ENV 就跑满 90 个 task」，白扔一整轮缓存。
"globalPassThroughEnv": [
  "CI", "NODE_ENV", "GITHUB_TOKEN", "VERCEL_TOKEN", "TURBO_TOKEN", "TURBO_TEAM"
]
```

`VITE_*` 通配符覆盖所有 26 个前端构建时变量。后端环境变量不需要声明——后端在运行时从 `.env` 读取，不影响构建产物。

> 更细的一层：`VITE_*` 是**进程环境**里的变量；Vite 构建时还会从磁盘读 `env-local/.env*`
> （`envDir`），那一份靠 `inputs` 里的 `env-local/**` 进缓存键 —— 两条通道都要管，
> 详见 [Turbo 缓存边界 §4.3](./turbo-cache-boundary)。

### 4. Tag-Based 架构边界

Turbo 2.9 的实验性功能——通过标签声明包的角色并强制依赖方向：

```jsonc
// 根 turbo.json（2026-08-08 升级为 platform 维度，见 ADR 0017）
{
  "boundaries": {
    "tags": {
      "shared": { "dependencies": { "deny": ["app"] } },         // shared 包不能依赖 app 包
      "backend": { "dependencies": { "deny": ["platform-web"] } }, // 后端不能依赖 web 平台包
      "platform-any": { "dependencies": { "deny": ["platform-web", "platform-node"] } },
      "platform-node": { "dependencies": { "deny": ["platform-web"] } }
    }
  }
}
```

各包的标签（platform 维度，2026-08-08；`packages/tooling/` 于 2026-09-23 拆成 5 个包、同日再加
`@walnut/vitest-config`，本表同步为 **15 行**）：

| 包 | 标签 |
|----|------|
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

> 6 个 tooling 包的 workspace 级 `turbo.json` 内容相同（`{"extends": ["//"], "tags": ["tooling", "platform-any"]}`）——
> 预设包是纯 JSON、脚本包由 Node 原生执行，**没有一个**依赖 `platform-web` 或某个 app。
> 原先那一行 `@walnut/tooling` 已随拆包消失。

```bash
pnpm turbo boundaries   # 检查是否有包违反了边界规则（pre-push 与 CI 中强制执行）
```

## 没做什么 / 为什么

### 不配置 Remote Cache（已决定，2026-08-08）

Turborepo Remote Cache（Vercel 托管或自建）可以跨 CI 机器共享缓存，但当前是单人维护、CI 规模小，单机缓存已够用——**已决定不接入**。`globalPassThroughEnv` 保留 `TURBO_TOKEN`/`TURBO_TEAM` 透传，若未来 CI 并行度提升（多台机器同时构建），接入零配置改动。

### CI 使用 affected-only

CI（`.github/workflows/ci.yml`）对 `lint` / `types:check` / `test` 使用 `turbo run <task> --affected`——只检查受变更影响的包。`turbo boundaries` 检查全仓（tag 规则与受影响集无关，全量扫描也只需数秒）。

**必须显式给出比较基准**：`--affected` 默认对比"当前分支与默认分支的 merge-base"，而本仓是直接 push main —— merge-base 就是 HEAD 自身，受影响集会算成空集、门禁静默跳过。CI 里通过 `TURBO_SCM_BASE` / `TURBO_SCM_HEAD` 显式指定（PR 用 `base.sha`，push 用 `event.before`，全零时回退 `HEAD^`），并有一道"有文件变更但受影响包为 0 → 失败"的自检。
LINK https://turborepo.dev/docs/guides/skipping-tasks

---

## 常用命令

```bash
turbo build                    # 全量构建
turbo build --filter=@walnut/admin  # 只构建 admin
turbo build --filter=@walnut/admin...  # admin + 其依赖
turbo build --dry              # 看执行计划（不真跑）
turbo dev                      # 启动所有 dev server
turbo boundaries               # 检查架构边界
```

---

## 关键文件

| 文件 | 作用 |
|------|------|
| [turbo.json](https://github.com/walnut-admin/walnut-admin/blob/main/turbo.json) | 任务定义 + 缓存 + 边界 + 环境变量 |
| 各包的 `turbo.json` | 包级标签声明（`"tags": ["app", "frontend"]`） |

## 相关 ADR

- [ADR-0012: Frontend-Backend Toolchain Divergence](/content/adr/0012-toolchain-divergence.md)（Decision 3-6）
