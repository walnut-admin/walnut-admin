# Step 6: Turbo Configuration

调整 Turbo 配置以支持 3 个 app（admin + server + docs）的统一编排。

## Checklist

- [ ] 1. 更新 `turbo.json` — 补充 docs 输出目录
- [ ] 2. 确认各 package turbo task 对齐
- [ ] 3. 理解根命令行为

---

## 1. 更新 `turbo.json`

当前 `turbo.json` 的 `build` task：
```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"],
      "cache": true
    }
  }
}
```

`outputs` 只有 `dist/**`，但 docs（Vitepress）的构建产物在 `.vitepress/dist/`，需要补充：

```diff
- "outputs": ["dist/**"],
+ "outputs": ["dist/**", ".vitepress/dist/**"],
```

### 完整 `turbo.json`（修改后）

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["tsconfig.base.json", "eslint.config.mjs"],
  "globalEnv": ["NODE_ENV"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".vitepress/dist/**"],
      "cache": true
    },
    "dev": {
      "dependsOn": ["^build"],
      "persistent": true,
      "cache": false
    },
    "lint": {
      "dependsOn": [],
      "cache": true
    },
    "lint:fix": {
      "dependsOn": [],
      "cache": true
    },
    "types:check": {
      "dependsOn": ["^build"],
      "cache": false
    },
    "preview": {
      "dependsOn": ["build"],
      "cache": false
    },
    "clean": {
      "dependsOn": [],
      "cache": false
    },
    "clean:all": {
      "dependsOn": [],
      "cache": false
    }
  }
}
```

### 关键配置说明

| 配置项 | 说明 |
|--------|------|
| `globalDependencies` | 这些文件变化时，所有 task 缓存失效 |
| `globalEnv: ["NODE_ENV"]` | 声明全局环境变量，turbo 在缓存 key 中包含它 |
| `dependsOn: ["^build"]` | `^` 表示先构建上游依赖（packages 先于 apps） |
| `persistent: true` | 用于 dev server（长期运行的进程），不会被缓存 |
| `cache: false` | 每次重新运行，不使用缓存（用于 dev、types:check） |

---

## 2. Turbo Task 对齐

Turbo 按 script 名称匹配 —— 每个 package 只要在 `package.json` 的 `scripts` 中有同名命令，turbo 就会执行它。

| turbo task | @walnut/admin | @walnut/server | @walnut/docs | packages/* |
|---|---|---|---|---|
| `build` | ✅ `build` | ✅ `build`（cross-env 后） | ✅ `build` | ✅ `build` |
| `dev` | ✅ `dev` | ✅ `dev`（cross-env 后） | ✅ `dev` | — |
| `lint` | ✅ `lint` | ✅ `lint` | ✅ `lint` | — |
| `lint:fix` | ✅ `lint:fix` | ⚠️ 可选 | ✅ `format`（alias） | — |
| `types:check` | ✅ `types:check` | ✅ `types:check`（从 `typecheck` 改名） | ✅ `types:check`（echo skipped） | 部分有 |

### Server `lint:fix` 可补充

`apps/server/package.json` 中目前没有 `lint:fix` script，可以加一个：

```json
"lint:fix": "eslint \"{src,apps,libs,test}/**/*.ts\" --fix --concurrency=auto"
```

或者 turbo 会跳过没有此 script 的 package，不影响整体运行。

---

## 3. 根命令行为

| 根命令 | Turbo 行为 | 适用场景 |
|--------|-----------|---------|
| `pnpm lint` | 递归所有 app + package 的 `lint` | 提交前全量检查 |
| `pnpm types:check` | 递归所有 app + package 的 `types:check` | 类型检查 |
| `pnpm build` | packages 先构建 → apps 后构建（依赖拓扑排序） | CI 全量构建 |
| `pnpm dev:admin` | 仅 `turbo dev --filter=@walnut/admin` | 日常前端开发 |
| `pnpm dev:server` | 仅 `turbo dev --filter=@walnut/server` | 日常后端开发 |
| `pnpm dev:docs` | 仅 `turbo dev --filter=@walnut/docs` | 日常文档编写 |
| `pnpm dev` | `turbo dev` 启动所有 app 的 dev server | **一般不推荐**，会同时启动 3 个服务 |

> **注意**：`pnpm dev` 不加 filter 会同时启动 admin + server + docs 三个 dev server。日常开发请用 `pnpm dev:admin`、`pnpm dev:server`、`pnpm dev:docs`。

---

## 4. Turbo 不做什么

- **不管理 NestJS 内部构建** — server 的 `nest build` 由 `apps/server/package.json` 的 scripts 调用，turbo 只决定何时调用，不参与 SWC/tsc 的具体执行
- **不理解 NestJS 内部 monorepo** — server 的 9 个 lib（config、const、db...）是 NestJS CLI 管理的，turbo 视 server 为一个整体 package
- **不处理环境变量注入** — server 的 `NODE_ENV` 通过 `cross-env` 在 script 中设置，turbo 的 `globalEnv: ["NODE_ENV"]` 仅用于缓存 key 计算

---

## 5. 验证

```bash
# 列出 turbo 能管理的所有 package
pnpm turbo ls

# 预期输出类似：
# @walnut/admin
# @walnut/server
# @walnut/docs
# @walnut/shared
# @walnut/axios
# @walnut/core
# @walnut/ui
# @walnut/ai

# 试运行 build（dry run，不实际执行）
pnpm turbo build --dry-run
```

---

## 完成

- [ ] `turbo.json` 更新完成
- [ ] Task 对齐确认
- [ ] 理解根命令行为

下一步：[Step 7: Install & Verify](./07-install-verify.md)
