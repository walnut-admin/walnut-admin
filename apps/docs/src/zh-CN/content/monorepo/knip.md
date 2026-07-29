# Knip：死代码与无用依赖检测

## 概述

[Knip](https://knip.dev/) 是一个面向 TypeScript monorepo 的死代码检测工具。它会从每个包的入口文件出发，追踪整个 import 图，自动发现：

- **未使用的文件** —— 源码文件没有被任何地方 import
- **未使用的 exports** —— 函数/类型/变量 被导出但无消费者
- **未使用的 npm 依赖** —— `package.json` 中声明但代码未 import 的包
- **孤立的 catalog 条目** —— `pnpm-workspace.yaml` 中列了但无 `package.json` 引用的依赖

本项目已集成 Knip 6.29.0，配置文件位于仓库根目录 [`knip.config.ts`](https://github.com/walnut-admin/walnut-admin-client/blob/main/knip.config.ts)。

---

## 快速使用

```bash
# 全仓扫描（含 apps + packages）
pnpm knip

# 只扫共享包（零误报，最干净）
pnpm knip:packages

# 只扫应用
pnpm knip:apps

# 自动清理 unused exports
pnpm knip:fix
```

---

## 预期结果

| 命令 | 预期 | 说明 |
|------|------|------|
| `pnpm knip:packages` | **exit 0，零发现** | 共享包（contract / utils / client / axios / eslint-config）的 import 链完全显式，knip 可精确追踪 |
| `pnpm knip`（全仓） | exit 1，少量发现 | 大部分是框架隐式组装的已知误报，少量可能是真实死代码 |

---

## 配置设计

knip 的核心原理是**从入口文件出发，沿 import 链追踪**。因此每个 workspace 包都需要在 `knip.config.ts` 中声明 entry files。

### 共享包（packages/\*）

```ts
"packages/contract": {
  entry: ["src/index.ts"],  // barrel export → 追踪所有子模块
},
```

共享包的 import 链完全显式（`import { xxx } from '@walnut/contract'`），knip 可 100% 精确追踪。

### 前端应用（apps/admin）

```ts
"apps/admin": {
  entry: [
    "src/main.ts",                    // 应用入口
    "src/router/index.ts",            // 路由（import 所有页面）
    "src/router/routes/**/*.ts",      // 路由配置
  ],
  project: ["src/**/*.{ts,vue}"],
  vite: false,                        // 禁用 Vite 插件（见下文）
  ignore: [
    "src/components/**",              // auto-import 隐式注册
    "src/composables/**",             // 同上
    "src/hooks/**",                   // 同上
    "src/api/**",                     // barrel + store 动态引用
    "src/store/**",                   // Pinia 动态注册
    "src/socket/**",                  // 动态 import
    "src/types/**",                   // ambient 引用
    "src/const/**",                   // 同上
    "src/enums/**",                   // 同上
    "build/**",                       // 构建脚本
  ],
},
```

### 后端应用（apps/server）

```ts
"apps/server": {
  entry: ["apps/api/src/main.ts"],
  project: ["apps/**/*.ts", "libs/**/*.ts"],
  ignore: [
    "**/*.module.ts",                 // @Module() 装饰器隐式组装
    "**/*.controller.ts",             // @Controller() 同上
    "**/*.service.ts",                // @Injectable() DI
    "**/*.dto.ts",                    // 装饰器引用
    "**/*.schema.ts",                 // Mongoose 动态加载
    "**/*.guard.ts",                  // DI 组装
    "**/*.interceptor.ts",            // 同上
    "**/*.pipe.ts",                   // 同上
    "**/*.filter.ts",                 // 同上
    "**/*.decorator.ts",              // 同上
    "**/*.strategy.ts",               // 同上
    "**/*.middleware.ts",             // 同上
    "libs/*/src/index.ts",            // tsconfig paths 引用
    "infra/**",                       // SWC 构建配置
    "**/*.e2e-spec.ts",              // E2E 测试
    "**/vitest.config.*.ts",         // 测试配置
  ],
},
```

---

## 为什么 apps 有大量文件被忽略

knip 是**静态 import 追踪**工具。以下框架机制对 knip 不可见，必须手动排除：

| 框架 | 机制 | knip 能追踪？ |
|------|------|--------------|
| Vue 3 | `unplugin-auto-import`（自动注入 composables） | ❌ |
| Vue 3 | `unplugin-vue-components`（自动注册组件） | ❌ |
| Vue 3 | Pinia store 动态注册 | ❌ |
| NestJS | `@Module()` 装饰器隐式组装 | ❌ |
| NestJS | `@Controller()` / `@Injectable()` 依赖注入 | ❌ |
| NestJS | Mongoose schema 动态加载 | ❌ |
| Admin | vite.config.ts 在模块顶层调用 `JSON.parse(env)` | ❌ |

**对策**：这些文件类型在 `knip.config.ts` 中通过 `ignore` 排除在 unused files 检测之外。knip 仍会对它们做 export 级别的检测。

---

## 已知技术局限

### `~build/*` 路径别名

admin 中有 10 个文件 import `~build/package` 和 `~build/time`，knip 无法解析。这是因为 `vite-tsconfig-paths` 在构建时动态解析这些别名，knip 无此上下文。

**影响**：`pnpm knip` 输出中会有 10 条 `Unresolved imports`。不影响代码正确性。

### vite.config.ts 加载失败

admin 的 `vite.config.ts` 在模块顶层调用 `JSON.parse(env.VITE_PROXY)`，knip 的 jiti 加载器执行时 env 未定义 → `JSON.parse(undefined)` 抛异常。

**对策**：在 `apps/admin` workspace 配置中设置 `vite: false`，改为手动指定 entry files。

### Vite 插件 devDependencies

30+ 个 Vite 插件（如 `@vitejs/plugin-vue`、`unplugin-auto-import`）在 `devDependencies` 中声明但不会在源码中 import——它们只在 `vite.config.ts` 中引用。knip 无法解析 `vite.config.ts`，所以报告为 "unused devDependencies"。

**对策**：已加入 `ignoreDependencies` 列表。

---

## 如何解读输出

```text
Unused files (7)        ← 值得排查：可能真的有死文件
Unused dependencies (5) ← 值得排查：可能真的有没用到的包
Unlisted binaries (4)   ← CLI 工具在 scripts 中引用但未列在 dependencies
Unresolved imports      ← 路径别名问题，已知局限（见上文）
Unused exports (39)     ← 导出但无消费者，可按需清理
Unused catalog entries  ← pnpm-workspace.yaml 中的孤立条目
Configuration hints     ← knip 建议清理的冗余配置项（可忽略）
```

---

## 日常维护

### 添加新 workspace 包

在 [`knip.config.ts`](https://github.com/walnut-admin/walnut-admin-client/blob/main/knip.config.ts) 的 `workspaces` 中添加：

```ts
"packages/新包名": {
  entry: ["src/index.ts"],
},
```

### 添加新 app

参照现有 `apps/admin` 或 `apps/server` 的配置，根据框架类型选择合适的 entry 和 ignore 策略。

### CI 集成建议

可以将 `pnpm knip:packages` 加入 CI 门禁（packages 零误报，exit 0 即健康）。全仓 `pnpm knip` 由于存在已知误报，建议作为信息性检查而非硬门禁。

```yaml
# .github/workflows/ci.yml 示例片段
- name: Dead code check (packages)
  run: pnpm knip:packages
```

---

## 相关资源

- [Knip 官方文档](https://knip.dev/)
- [Knip Configuration 参考](https://knip.dev/reference/configuration)
- [Knip Known Issues](https://knip.dev/reference/known-issues)
- [Knip GitHub 仓库](https://github.com/webpro-nl/knip)（11.6k+ stars，周下载 770 万）
