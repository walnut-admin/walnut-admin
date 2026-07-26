# Monorepo 架构与设计体系

## 概述

Walnut Admin 是一个**全栈 TypeScript monorepo**，采用 **Turborepo + pnpm workspaces** 进行多包管理。项目从三个独立仓库（前端、后端、文档）合并而来，通过统一依赖管理、分层 TypeScript 配置、集中代码质量工具，构建了一套可维护的 monorepo 基础设施。

### 技术栈速览

| 层级 | 技术 |
|------|------|
| 包管理 | pnpm 11+（workspace + catalog） |
| 任务编排 | Turborepo 2.4 |
| 类型系统 | TypeScript 6.0 |
| 代码检查 | ESLint 10.3（flat config）+ @antfu/eslint-config |
| Git Hooks | simple-git-hooks + lint-staged |
| 前端框架 | Vue 3 + Vite 8 |
| 后端框架 | NestJS 11 + SWC |
| 文档引擎 | VitePress 1.6 |
| Node 要求 | >= 24.13.0 |

---

## 顶层设计

### 双层级 monorepo

项目存在**两层**包管理结构：

```
walnut-admin/                    ← Turborepo + pnpm workspace（外层）
├── apps/
│   ├── admin/                   ← Vue3 SPA 前端
│   ├── server/                  ← NestJS API 后端
│   │   ├── apps/api/            ← NestJS 应用入口
│   │   └── libs/                ← NestJS CLI monorepo（内层）
│   └── docs/                    ← VitePress 文档站
├── packages/                    ← 共享库（ESM，Vite 构建）
│   ├── shared/                  ← @walnut/shared
│   ├── axios/                   ← @walnut/axios
│   ├── core/                    ← @walnut/core
│   ├── ui/                      ← @walnut/ui
│   └── ai/                      ← @walnut/ai
├── turbo.json                   ← Turborepo 任务管线
├── pnpm-workspace.yaml          ← pnpm workspace + catalog
├── tsconfig.base.json           ← 前端 ESM 基类配置
├── tsconfig.base.node.json      ← 后端 CJS 基类配置
└── eslint.config.mjs            ← 根 ESLint 配置
```

**外层**（Turborepo 层面）：`apps/*` + `packages/*` 共 8 个 workspace 包，通过 pnpm workspace 协议相互引用。

**内层**（Server 内部）：`apps/server/` 下的 `apps/api/` + `libs/*` 是 NestJS CLI 管理的内部 monorepo，通过 TypeScript path aliases 解析，不走 pnpm workspace。

### 关键设计决策

1. **外层 ESM，内层 CJS**：frontend packages 和 apps 使用 ESM (`"type": "module"`)，server 及其 internal libs 使用 CommonJS。这是因为 NestJS 生态仍以 CJS 为主。
2. **两种 `@walnut/*` 作用域**：外层的 `@walnut/shared` 等 5 个包通过 pnpm workspace 解析；内层的 `@walnut/config` 等 9 个 lib 通过 tsconfig paths 解析。两者无命名冲突。
3. **统一依赖版本**：通过 pnpm catalog 将所有共享依赖的版本定义在一处（`pnpm-workspace.yaml`），消除版本漂移。

---

## 应用体系

### 1. `apps/admin/` — 前端 SPA

| 属性 | 值 |
|------|-----|
| 包名 | `@walnut/admin` |
| 框架 | Vue 3 + Vite 8 |
| 组件库 | Naive UI 2.44 |
| CSS 方案 | UnoCSS（Wind 预设，兼容 Tailwind v3） |
| 状态管理 | Pinia 3 |
| 路由 | Vue Router 5（web history） |
| 国际化 | Vue I18n 11 |
| 类型检查 | vue-tsc |
| 路径别名 | `@/*` → `src/*`，`~/*` → `types/*` |
| 开发端口 | 3100（API 代理到 3000） |

**安全特性**：OPAQUE 密码协议、WebAuthn/FIDO2、MFA/OTP、RSA 加密、设备指纹。

### 2. `apps/server/` — 后端 API

| 属性 | 值 |
|------|-----|
| 包名 | `@walnut/server` |
| 框架 | NestJS 11（Express 适配器） |
| 编译器 | SWC（非 tsc） |
| 模块系统 | CommonJS |
| 数据库 | MongoDB（Mongoose 9，需副本集） |
| 缓存 | Redis（缓存 + Bull 队列 + 分布式锁） |
| 安全 | 18 个守卫、16 个中间件、多层认证链 |
| 认证 | JWT + OAuth + OPAQUE + WebAuthn + MFA/TOTP |
| 路径别名 | `@/*` → `apps/api/src/*` |

#### Server 内部 Monorepo

Server 内部通过 NestJS CLI + SWC 管理 9 个内部库：

```
apps/server/libs/
├── config/       @walnut/config       — 环境配置 + 验证
├── const/        @walnut/const        — 常量 + 错误码
├── context/      @walnut/context      — ALS 上下文
├── db/           @walnut/db           — Mongoose + 事务
├── decorators/   @walnut/decorators   — 自定义装饰器体系
├── exceptions/   @walnut/exceptions   — 异常 + 全局过滤器
├── pipes/        @walnut/pipes        — 参数管道
├── types/        @walnut/types        — 类型声明
└── utils/        @walnut/utils        — 工具函数
```

这些 lib 通过 `apps/server/tsconfig.json` 中的 paths 映射解析，由 NestJS CLI 统一编译，**不参与** pnpm workspace。

### 3. `apps/docs/` — 文档站

| 属性 | 值 |
|------|-----|
| 包名 | `@walnut/docs` |
| 框架 | VitePress 1.6 |
| 语言 | 简体中文 |
| 源目录 | `src/zh-CN/` |
| 开发端口 | 8886 |

---

## 共享包体系

5 个共享包位于 `packages/`，均为 **`private: true`**（不发包），ESM 模块，Vite 构建。

### 包依赖关系图

```
@walnut/shared                    ← 零依赖基础层
    ↑
@walnut/axios                     ← HTTP 客户端（依赖 shared）
    ↑
@walnut/core                      ← stores、router、hooks（依赖 shared）
    ↑
@walnut/ui                        ← WTable/WForm/CRUD 组件（依赖 shared + core）
    ↑
@walnut/ai                        ← AI 聊天子系统（依赖 shared + axios + core + ui）
```

### 各包职责

| 包 | 职责 | 核心内容 |
|----|------|---------|
| `@walnut/shared` | 零依赖基础层 | 工具函数、类型定义、常量、idb 封装 |
| `@walnut/axios` | HTTP 客户端 | 请求拦截、响应处理、缓存策略 |
| `@walnut/core` | 核心状态 | Pinia stores、Vue Router 配置、组合式函数 |
| `@walnut/ui` | UI 组件库 | WTable、WForm、CRUD 组件、图表封装 |
| `@walnut/ai` | AI 子系统 | AI 聊天、markdown 渲染、代码高亮 |

### 依赖类型：peerDep → dependency

5 个包原本使用 `peerDependencies` 声明对 `vue`、`naive-ui`、`vue-router` 等框架库的依赖。由于全部是 `private: true`（永不发包），peerDep 的设计意图（让宿主项目提供依赖）在此场景下不适用。已全部改为 `dependencies`：

| 包 | 转换数量 | 示例 |
|----|---------|------|
| shared | 7 | vue, @vueuse/core, lodash-es, nanoid, superjson... |
| axios | 4 | axios, lodash-es, lru-cache, nanoid |
| core | 4 | vue, vue-router, naive-ui, @vueuse/core |
| ui | 14 | vue, naive-ui, pinia, echarts, markdown-it... |
| ai | 6 | vue, naive-ui, highlight.js, markdown-it... |

---

## 依赖管理体系

### pnpm Catalog（单一版本源）

所有跨包共享的依赖版本统一定义在 [`pnpm-workspace.yaml`](../../../pnpm-workspace.yaml) 的 `catalog:` 字段下，~50 个条目：

```yaml
catalog:
  # 框架
  vue: "3.5.34"
  vue-router: "5.0.6"
  pinia: "3.0.4"
  naive-ui: "2.44.1"

  # 运行时共享
  axios: "1.16.0"
  nanoid: "5.1.11"
  dayjs: "1.11.20"

  # 构建 & 开发
  typescript: "6.0.3"
  vite: "8.0.11"
  eslint: "10.3.0"
  @types/node: "25.5.0"
  # ... 共 ~50 个条目
```

各 `package.json` 中使用 `"catalog:"` 引用：

```json
{
  "dependencies": {
    "vue": "catalog:",
    "axios": "catalog:"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vite": "catalog:"
  }
}
```

### 版本对齐要点

| 包 | 统一前（分散版本） | 统一后 | 说明 |
|----|-------------------|--------|------|
| vue | 3.5.34 / 3.5.25 | 3.5.34 | 取最高版本 |
| vite | 8.0.11 / 5.4.19 | 8.0.11 | docs 删除独立 vite 声明（VitePress 内建） |
| axios | 1.16.0 / 1.14.0 | 1.16.0 | 小版本升级 |
| @types/node | 24.12.3 / 25.5.0 / 22.16.0 | 25.5.0 | 对齐 engine Node >= 24.13 |
| nanoid | 5.1.11 / 5.1.7 | 5.1.11 | patch 升级 |

### Overrides（消除重复传递依赖）

在 `pnpm-workspace.yaml` 中通过 `overrides:` 统一传递依赖版本：

```yaml
overrides:
  glob: "11.1.0"
  lru-cache: "11.3.6"
```

### 其他配置

```yaml
hoisting: true          # pnpm 11 替代 .npmrc shamefully-hoist
allowBuilds:            # pnpm 11 需要显式允许 postinstall 脚本
  '@swc/core': true
  esbuild: true
  simple-git-hooks: true
  # ... 共 17 个
```

---

## TypeScript 配置体系

### 双基类设计

针对前端 ESM 和后端 CJS 的不同需求，设计了两个基类配置：

#### `tsconfig.base.json` — 前端 ESM 基类

被 `apps/admin/`、`apps/docs/` 和 5 个 `packages/*/` 继承：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "jsxImportSource": "vue",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "paths": {
      "@walnut/shared": ["./packages/shared/src"],
      "@walnut/axios": ["./packages/axios/src"],
      "@walnut/core": ["./packages/core/src"],
      "@walnut/ui": ["./packages/ui/src"],
      "@walnut/ai": ["./packages/ai/src"]
    }
  }
}
```

`@walnut/*` 路径别名**集中定义在 base 中**，此前在 6 个 tsconfig 中重复声明，现已消除。

#### `tsconfig.base.node.json` — 后端 CJS 基类

供 Server 内部 lib 的 `tsconfig.lib.json` 继承：

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node10",
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "strict": true,
    "declaration": true,
    "skipLibCheck": true
  }
}
```

### 配置继承链

```
tsconfig.base.json                         tsconfig.base.node.json
    ↑                                               ↑
    ├── apps/admin/tsconfig.json                    └── apps/server/tsconfig.json
    ├── apps/docs/tsconfig.json                         ↑
    ├── packages/shared/tsconfig.json                    ├── libs/*/tsconfig.lib.json
    ├── packages/axios/tsconfig.json
    ├── packages/core/tsconfig.json
    ├── packages/ui/tsconfig.json
    └── packages/ai/tsconfig.json

tsconfig.json (根目录，独立最小化配置，仅覆盖根级配置文件)
```

### Root `tsconfig.json`

根目录的 `tsconfig.json` 是**独立的最小化 ESM 配置**，不 extend 任何 base：

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true
  },
  "include": ["*.mjs", "*.ts", "*.js"],
  "exclude": ["node_modules", "dist", ".turbo", "**/dist/**"]
}
```

职责：为根目录配置文件（`eslint.config.mjs`、`*.config.ts` 等）提供 IDE 类型支持，**不**包含 app 源文件——各 app 有自己的 tsconfig。

### Server lib rootDir 统一

Server 9 个内部 lib 的 `rootDir` 已统一为 `"./src"`（此前 5 个使用 `".."`），匹配 NestJS schematics 规范。

---

## 代码质量控制

### ESLint 体系

采用 **ESLint flat config** + **`@antfu/eslint-config`**，三层配置结构：

| 配置层级 | 文件 | 负责范围 |
|---------|------|---------|
| Root | `eslint.config.mjs` | 根目录配置文件 + 全局 ignores |
| Admin | `apps/admin/eslint.config.mjs` | 前端 SPA 源码 |
| Server | `apps/server/eslint.config.mjs` | 后端 NestJS 源码 |
| Docs | `apps/docs/eslint.config.mjs` | 文档站配置文件 |

#### Root ESLint 配置

```javascript
import antfu from '@antfu/eslint-config'

export default antfu({
  ignores: ['**/dist/**', 'pnpm-lock.yaml'],
  markdown: false,    // 根目录不检查 markdown
  unocss: true,       // 启用 UnoCSS 规则
  rules: {
    'ts/no-namespace': 'off',
    'no-console': 'off',
    'pnpm/json-enforce-catalog': 'off',
    'pnpm/enforce-catalog': 'off',
    'pnpm/yaml-enforce-settings': 'off',
  },
})
```

#### Server ESLint 配置（特殊规则）

Server 有自己的 [`eslint-local-rules.mjs`](../../../apps/server/eslint-local-rules.mjs) 插件，包含自定义的 NestJS 装饰器排序规则 `local/sort-nestjs-decorators`，确保装饰器按约定顺序排列。

### Turborepo Lint 管线

```json
{
  "lint": {
    "dependsOn": [],
    "inputs": ["src/**", "eslint.config.*", "tsconfig.json", "package.json"],
    "cache": true
  }
}
```

每个 workspace 包定义自己的 `lint` 脚本。Turbo 并行执行所有包的 lint 任务，当前 8 个包：

```
pnpm lint → turbo lint → 并行执行 8 个包
  ├── @walnut/admin      eslint . --concurrency=auto
  ├── @walnut/server     eslint "{src,apps,libs,test}/**/*.ts" --concurrency=auto
  ├── @walnut/docs       eslint . --concurrency=auto
  ├── @walnut/shared     eslint . --concurrency=auto
  ├── @walnut/axios      eslint . --concurrency=auto
  ├── @walnut/core       eslint . --concurrency=auto
  ├── @walnut/ui         eslint . --concurrency=auto
  └── @walnut/ai         eslint . --concurrency=auto
```

此外还有根级 lint：

| 命令 | 作用 | 运行方式 |
|------|------|---------|
| `pnpm lint` | Lint 所有 workspace 包 | `turbo lint`（8 包并行） |
| `pnpm lint:root` | Lint 根目录配置文件 | `eslint . --concurrency=auto`（直接运行） |
| `pnpm lint:fix` | Lint + 自动修复 | `turbo lint:fix` |
| `pnpm lint:root:fix` | 根目录 lint + 修复 | `eslint . --fix --concurrency=auto` |

### Git Hooks

用 `simple-git-hooks` + `lint-staged` 替代了 commitlint：

```json
{
  "simple-git-hooks": {
    "pre-commit": "pnpm lint-staged",
    "pre-push": "pnpm types:check"
  },
  "lint-staged": {
    "*.{ts,vue,mjs,js}": "eslint --fix --concurrency=auto",
    "*.md": "eslint --fix"
  }
}
```

- **pre-commit**：lint-staged 仅检查暂存文件
- **pre-push**：全量 TypeScript 类型检查

### TypeScript 类型检查

```bash
pnpm types:check   # → turbo types:check（13 个包并行）
```

当前 13 个 types:check 任务全部通过。

---

## Turborepo 构建与开发流程

### 任务管线

```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],       // 先构建依赖包
      "outputs": ["dist/**"],
      "cache": true
    },
    "dev": {
      "persistent": true,             // 持续运行
      "interruptible": true,          // Ctrl+C 中断
      "cache": false
    },
    "lint":          { "cache": true },
    "lint:fix":      { "cache": true },
    "types:check": {
      "dependsOn": ["^build"],       // 先构建依赖包（生成 .d.ts）
      "cache": true
    },
    "clean":         { "cache": false }
  }
}
```

### 常用命令

| 命令 | 说明 |
|------|------|
| `pnpm dev` | 启动所有 dev server |
| `pnpm dev:admin` | 仅启动前端 |
| `pnpm dev:server` | 仅启动后端（需 MongoDB + Redis） |
| `pnpm dev:docs` | 仅启动文档站 |
| `pnpm build` | 构建全部（8G 内存） |
| `pnpm lint` | Lint 全部 workspace 包 |
| `pnpm lint:root` | Lint 根目录配置文件 |
| `pnpm types:check` | 类型检查全部 |
| `pnpm clean` | 清理构建产物 |

### 全局依赖与环境变量

```json
{
  "globalDependencies": [
    "tsconfig.base.json",
    "tsconfig.json",
    "eslint.config.mjs"
  ],
  "globalPassThroughEnv": [
    "CI", "GITHUB_TOKEN", "VERCEL_TOKEN"
  ]
}
```

修改 `tsconfig.base.json` 或 `eslint.config.mjs` 会导致所有包的缓存失效，确保基建变更后全量重建。

---

## 目录结构速查

```
walnut-admin/
├── apps/
│   ├── admin/                    ← @walnut/admin（Vue3 SPA）
│   │   ├── src/
│   │   ├── types/
│   │   ├── vite.config.ts
│   │   ├── tsconfig.json         ← extends tsconfig.base.json
│   │   └── eslint.config.mjs
│   ├── server/                   ← @walnut/server（NestJS API）
│   │   ├── apps/api/             ← NestJS 应用入口
│   │   ├── libs/                 ← 9 个内部库（CJS）
│   │   ├── infra/nest/           ← nest-cli 构建配置
│   │   ├── infra/swc/            ← SWC 编译器配置
│   │   ├── env/                  ← 环境变量模板
│   │   ├── env-local/            ← 本地环境变量（gitignored）
│   │   ├── tsconfig.json         ← CJS，独立配置
│   │   └── eslint.config.mjs
│   └── docs/                     ← @walnut/docs（VitePress）
│       ├── .vitepress/config/    ← 主题 + 导航配置
│       ├── src/zh-CN/            ← 中文文档内容
│       ├── tsconfig.json         ← extends tsconfig.base.json
│       └── eslint.config.mjs
├── packages/
│   ├── shared/                   ← @walnut/shared（基础层）
│   ├── axios/                    ← @walnut/axios（HTTP 客户端）
│   ├── core/                     ← @walnut/core（状态 + 路由）
│   ├── ui/                       ← @walnut/ui（组件库）
│   └── ai/                       ← @walnut/ai（AI 子系统）
├── turbo.json                    ← Turborepo 任务管线
├── pnpm-workspace.yaml           ← workspace + catalog + overrides
├── tsconfig.base.json            ← 前端 ESM 基类
├── tsconfig.base.node.json       ← 后端 CJS 基类
├── tsconfig.json                 ← 根级最小化配置
├── eslint.config.mjs             ← 根 ESLint 配置
└── package.json                  ← 根 workspace 配置
```

---

## 迁移历史

当前 monorepo 由三个独立仓库合并而来（Phase 1）：

| 原仓库 | 合并后位置 |
|--------|-----------|
| `walnut-admin-client` | `apps/admin/` + 根 workspace 配置 |
| `walnut-admin-server` | `apps/server/` |
| `walnut-admin-doc` | `apps/docs/` |

Phase 2（规划中）：packages 重新设计，提取真正的可复用库。

详见 [`migration-guide/`](../../../migration-guide/) 目录下的迁移文档。
