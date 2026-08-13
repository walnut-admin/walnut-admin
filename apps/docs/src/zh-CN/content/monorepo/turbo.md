# Turbo

## 概述

Walnut Admin 使用 **Turborepo 2.9** 作为任务编排引擎。它负责解决三个核心问题：(1) 按依赖拓扑顺序执行任务；(2) 缓存构建产物避免重复计算；(3) 只对受变更影响的包执行任务。

## 我们做了什么

### 1. 任务拓扑编排

[`turbo.json`](https://github.com/walnut-admin/walnut-admin/blob/main/turbo.json) 定义了 9 个任务：

```jsonc
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],        // ← 关键：先构建所有上游依赖
      "outputs": ["dist/**", ".vitepress/dist/**"],
      "env": ["VITE_*", "MODE"]       // 环境变量影响 → 变更时缓存失效
    },
    "build:stage": {
      "dependsOn": ["^build:stage"],  // admin 侧 vite build --mode stage
      "outputs": ["dist/**", ".vitepress/dist/**"],
      "env": ["VITE_*", "MODE"]
    },
    "dev": {
      "dependsOn": ["^build"],       // 先构建上游 CJS 产物（server 运行时 require 依赖）
      "persistent": true,              // 长期运行（dev server）
      "interruptible": true,           // 允许被信号中断（配合 persistent）
      "cache": false                   // 不缓存
    },
    "lint":        { "dependsOn": [], "cache": true },
    "lint:fix":    { "dependsOn": [], "cache": false },
    "types:check": { "dependsOn": [], "cache": true },
    "test":        { "dependsOn": ["^build"], "cache": true },
    "clean":       { "dependsOn": [], "cache": false },
    "clean:all":   { "dependsOn": [], "cache": false }
  }
}
```

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
    "$TURBO_DEFAULT$",    // 默认 hash 包内所有文件
    "!README.md",         // 排除——README 变更不影响构建
    "!**/*.md",           // 排除——Markdown 变更不影响构建
    "!**/tsconfig.tsbuildinfo"  // 排除——增量编译元数据
  ],
  "outputs": ["dist/**", ".vitepress/dist/**"]  // 声明构建产物位置（用于缓存恢复）
}
```

**效果**：没改过的包 → 200ms 从缓存恢复（vs 重新构建的 10-30s）。"CI 中 cache hit 率通常 > 80%" 是**期望值**——CI workflow（`.github/workflows/ci.yml`）已接入，该指标待实测。

### 3. 环境变量感知

Turbo 2.x 的 **Strict Environment Mode** 要求显式声明 task 依赖哪些环境变量：

```jsonc
"build": {
  "env": ["VITE_*", "MODE"]     // 这些变量变更 → 缓存失效
}
```

```jsonc
"globalEnv": ["NODE_ENV"]       // 变更 → 全部任务缓存失效

"globalPassThroughEnv": [       // 运行时可见但不影响缓存的变量
  "CI", "GITHUB_TOKEN", "VERCEL_TOKEN", "TURBO_TOKEN", "TURBO_TEAM"
]
```

`VITE_*` 通配符覆盖所有 26 个前端构建时变量。后端环境变量不需要声明——后端在运行时从 `.env` 读取，不影响构建产物。

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

各包的标签（platform 维度，2026-08-08）：

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
| `@walnut/eslint-config` | `tooling`, `platform-any` |
| `@walnut/release` | `tooling`, `platform-any` |
| `@walnut/commitlint-config` | `tooling`, `platform-any` |

```bash
pnpm turbo boundaries   # 检查是否有包违反了边界规则（pre-push 与 CI 中强制执行）
```

## 没做什么 / 为什么

### 不配置 Remote Cache

Turborepo Remote Cache（Vercel 托管或自建）可以跨 CI 机器共享缓存。Walnut Admin 当前 CI 规模小，单机缓存已够用。如果 CI 并行度提升（多台机器同时构建），再加也不迟（`globalPassThroughEnv` 已预留 `TURBO_TOKEN`/`TURBO_TEAM` 透传，接入时零配置改动）。

### CI 使用 affected-only

CI（`.github/workflows/ci.yml`）对 `lint` / `types:check` / `test` 使用 `turbo run <task> --affected`——只检查受变更影响的包。`turbo boundaries` 检查全仓（tag 规则与受影响集无关，全量扫描也只需数秒）。

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
