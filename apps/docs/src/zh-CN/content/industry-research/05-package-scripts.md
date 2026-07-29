# Package Scripts 与 Turbo 任务编排

> 大型 monorepo 中，`package.json` 的 `scripts` 字段和 `turbo.json` 的任务定义是**同一枚硬币的两面**。每个包的 scripts 定义"做什么"，turbo.json 定义"怎么做、什么顺序、如何缓存"。本文档覆盖业界标准的脚本模式和 Turbo 编排最佳实践。

---

## 1. Package Scripts 设计原则

### 1.1 每个包应有一套标准脚本

大型 monorepo（如 Astro、tRPC、Vercel 的 turborepo 示例仓库）中，每个包至少包含这些 scripts：

```jsonc
{
  "scripts": {
    "build": "tsc",              // 构建产物
    "dev": "tsc --watch",        // 开发模式（持续编译）
    "clean": "rm -rf dist",      // 清理构建产物
    "typecheck": "tsc --noEmit", // 纯类型检查（不产出文件）
    "lint": "eslint src/",       // ESLint
    "lint:fix": "eslint --fix src/",
    "test": "vitest run",        // 单次测试
    "test:watch": "vitest",      // 持续测试
    "test:coverage": "vitest run --coverage"
  }
}
```

**一致性 > 自由度**。每个包都用相同的 script 名称，Turbo 才能统一编排。不要有的包叫 `lint`，有的叫 `eslint`。

### 1.2 根目录 scripts 只做委托

```jsonc
// root package.json — 根目录 scripts 应该是很薄的
{
  "scripts": {
    // 委托给 turbo
    "build": "turbo build",
    "dev": "turbo dev",
    "lint": "turbo lint",
    "lint:fix": "turbo lint:fix",
    "test": "turbo test",
    "typecheck": "turbo typecheck",

    // 全局操作（不在 turbo 中）
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "clean": "turbo clean && rm -rf node_modules .turbo",

    // 便捷命令
    "dev:admin": "pnpm --filter @walnut/admin dev",
    "dev:server": "pnpm --filter @walnut/server dev",
    "dev:all": "turbo dev",

    // 发布
    "changeset": "changeset",
    "version": "changeset version",
    "release": "changeset publish"
  }
}
```

**关键规则**：
- 根 scripts **不包含构建逻辑**——只委托给 turbo
- 用 `pnpm --filter` 做单包操作
- 全局命令（format）不放 turbo——Prettier 不应该按包并行化

---

## 2. turbo.json 任务编排体系

### 2.1 核心概念

```jsonc
// turbo.json (Turborepo v2)
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      // dependsOn: 定义这个 task 的前置依赖
      "dependsOn": ["^build"],  // ^ 前缀 = topological（先执行依赖的 build）
      // outputs: 声明这个 task 产生哪些文件（用于缓存）
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      // inputs: 声明哪些文件变更会导致缓存失效
      "inputs": ["src/**", "package.json", "tsconfig.json"]
    },
    "lint": {
      "dependsOn": ["^lint"],   // 先 lint 依赖包
      "outputs": []              // lint 不产生文件
    },
    "test": {
      "dependsOn": ["build"],    // 需要当前包的 build 产物
      "outputs": ["coverage/**"]
    },
    "dev": {
      "cache": false,            // dev server 不缓存
      "persistent": true         // 长期运行的进程
    }
  }
}
```

### 2.2 `dependsOn` 的三种写法

| 写法 | 含义 | 使用场景 |
|------|------|---------|
| `["^build"]` | 先执行**所有上游依赖**的 build | 最常见的模式——依赖构建完我再构建 |
| `["build"]` | 先执行**自己**的 build | test 依赖自己的 build 产物 |
| `["@repo/types#build"]` | 先执行**指定包**的 build | 精确控制（少用，`^` 更好） |

### 2.3 完整的任务依赖图

```
dep:types#build ──→ dep:utils#build ──→ app:admin#build
                                       ──→ app:server#build

dep:types#lint ───→ dep:utils#lint ───→ app:admin#lint
                                       ──→ app:server#lint

app:admin#build ──→ app:admin#test
app:server#build ─→ app:server#test
```

### 2.4 任务依赖的典型配置

```jsonc
{
  "tasks": {
    // === 构建任务链 ===
    "build": {
      "dependsOn": ["^build"],      // 1. 先构建依赖
      "outputs": ["dist/**"],
      "inputs": ["src/**", "package.json", "tsconfig.json"]
    },

    // === 质量门禁 ===
    "lint": {
      "dependsOn": ["^lint"],       // 并行：各包独立 lint
      "outputs": []
    },
    "lint:fix": {
      "outputs": []                 // 无前置依赖，纯修改文件
    },
    "typecheck": {
      "dependsOn": ["^build"],      // 需要依赖的 .d.ts 文件
      "outputs": []
    },

    // === 测试链 ===
    "test": {
      "dependsOn": ["build"],       // 先构建自己，再跑测试
      "outputs": ["coverage/**"],
      "inputs": ["src/**", "test/**", "**/*.test.*", "**/*.spec.*"]
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "cache": false,
      "outputs": []
    },

    // === 开发 ===
    "dev": {
      "cache": false,
      "persistent": true
    },

    // === 清理 ===
    "clean": {
      "cache": false,
      "outputs": []
    }
  }
}
```

---

## 3. 缓存策略优化

### 3.1 `inputs` 精确化

默认情况下，turbo 会 hash 包内**所有**文件来决定缓存是否有效。这意味着改了 `README.md` 也会让构建缓存失效。

**用 `inputs` 精确控制哪些文件参与缓存 hash**：

```jsonc
"build:ui": {
  "inputs": [
    "src/**/*.{ts,tsx}",      // 只关注源码
    "package.json",            // 依赖变化 → 重新构建
    "tsconfig.json"            // 配置变化 → 重新构建
  ],
  "outputs": ["dist/**"]
}
```

### 3.2 `outputs` 声明

不声明 `outputs` → turbo 无法缓存构建产物 → 每次都要重新跑。

```jsonc
"build": {
  "outputs": [
    "dist/**",                     // 构建产物
    "!.next/cache/**"              // 排除 Next.js 缓存目录
  ]
}
```

**`!` 前缀表示排除**。

### 3.3 缓存禁用场景

```jsonc
"dev": {
  "cache": false,       // dev server 不缓存
  "persistent": true    // turbo 不等待此 task 结束
},
"deploy": {
  "cache": false        // deploy 每次都要跑
}
```

---

## 4. 环境变量与缓存

### 4.1 严格模式（默认）

Turborepo v2 **默认 Strict Environment Mode**。只传递给 task 声明过的环境变量。未声明的环境变量不可用 + 不在缓存 hash 中。

### 4.2 `env` vs `passThroughEnv`

```jsonc
{
  "globalEnv": ["NODE_ENV"],           // 所有 task 可见 + 参与缓存 hash
  "globalPassThroughEnv": ["CI"],      // 所有 task 可见 + 不参与缓存 hash

  "tasks": {
    "build": {
      "env": ["DATABASE_URL"],         // 此 task 可见 + 参与缓存 hash
      "passThroughEnv": ["SENTRY_AUTH_TOKEN"] // 此 task 可见 + 不参与缓存 hash
    }
  }
}
```

| 字段 | 运行时可见 | 影响缓存 hash |
|------|-----------|--------------|
| `env` / `globalEnv` | ✅ | ✅ 变了就 cache miss |
| `passThroughEnv` / `globalPassThroughEnv` | ✅ | ❌ 变了不影响 cache |

**什么时候用哪个？**

- `DATABASE_URL` 变化 → 可能导致构建结果不同 → `env`（参与 hash）
- `SENTRY_AUTH_TOKEN` 变化 → 只是为了上传 source map，不影响构建产物 → `passThroughEnv`

---

## 5. 按包类型的 scripts 模板

### 5.1 纯工具包（`@walnut/utils`）

```jsonc
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "lint:fix": "eslint --fix src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage"
  }
}
```

### 5.2 Vue 应用（`@walnut/admin`）

```jsonc
{
  "scripts": {
    "dev": "vite --port 3100",
    "build": "vue-tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "vue-tsc --noEmit",
    "lint": "eslint src/",
    "lint:fix": "eslint --fix src/",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test"
  }
}
```

### 5.3 NestJS 后端（`@walnut/server`）

```jsonc
{
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "typecheck": "tsc --noEmit",
    "lint": "eslint \"{src,apps,libs,test}/**/*.ts\"",
    "lint:fix": "eslint --fix \"{src,apps,libs,test}/**/*.ts\"",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run --config vitest.e2e.config.ts"
  }
}
```

### 5.4 共享类型/合约包（`@walnut/contract`）

```jsonc
{
  "scripts": {
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "lint:fix": "eslint --fix src/",
    "test": "vitest run"     // 快照测试、常量有效性测试
  }
}
```

---

## 6. 常用 turbo 命令

### 6.1 日常开发

```bash
# 跑所有包的 dev
turbo dev

# 只跑 admin 及其依赖
turbo dev --filter=@walnut/admin...

# 构建变更的包
turbo build --filter='[origin/main]'

# 跑所有 lint
turbo lint

# 跑 lint + typecheck + test + build（一条龙）
turbo run lint typecheck test build
```

### 6.2 调试与诊断

```bash
# 查看执行计划（不真正执行）
turbo build --dry

# 查看执行计划，并显示每个 task 会跑在哪个包
turbo build --dry=json | jq '.tasks | map({task, package})'

# 查看远程缓存状态
turbo config

# 强制忽略缓存（重新执行全部）
turbo build --force
```

### 6.3 filter 语法速查

```bash
turbo build --filter=@walnut/admin           # 单个包
turbo build --filter=@walnut/admin...        # 包 + 其依赖
turbo build --filter='...@walnut/utils'      # 包 + 依赖它的包
turbo build --filter='./apps/*'              # glob 匹配
turbo build --filter='[origin/main]'         # git diff 变更的包
turbo build --filter='[origin/main]...'      # 变更的包 + 它们的依赖
```

---

## 7. pnpm catalog + scripts 协同

### 7.1 为什么 catalog 对 scripts 重要

当所有包通过 `catalog:` 引用同一版本的 `typescript`、`eslint`、`vitest` 时，这些工具的 scripts 行为是**完全一致**的——不存在"包 A 的 `tsc 5.5` 支持的 flag 在包 B 的 `tsc 5.0` 上报错"的情况。

```yaml
# pnpm-workspace.yaml
catalog:
  typescript: ^6.0.0
  eslint: ^9.0.0
  vitest: ^4.0.0
  prettier: ^3.0.0
```

### 7.2 版本升级的 scripts 联动

```bash
# 1. 升级 catalog 中的版本
#    编辑 pnpm-workspace.yaml，改 typescript: ^6.1.0

# 2. 安装新版
pnpm install

# 3. 全量重新构建（因为 tsc 升级，缓存全部失效）
turbo build --force

# 4. 重新检查类型（因为 tsc 升级，可能有新错误）
pnpm typecheck

# 5. 如果有 breaking changes，逐步 fix
turbo lint:fix
turbo test
```

---

## 8. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 差距 |
|---------|-------------------|------|
| 标准 scripts 约定 | ✅ 基本齐全（build/dev/lint/test） | 可增加 `clean` 和 `test:coverage` |
| root scripts 只委托 turbo | ✅ `turbo build` / `turbo lint` 等 | 符合 |
| `dependsOn: ["^build"]` | ✅ 已有 | 符合 |
| `persistent: true` for dev | ✅ 已有 | 符合 |
| `inputs` 精确化 | ❌ 未配置 | 当前规模小，改 README 导致缓存失效影响不大 |
| `env` vs `passThroughEnv` | ❌ 未区分 | 当前无此需求 |
| catalog + scripts 协同 | ✅ ADR-0011 `catalogMode: strict` | 符合 |
