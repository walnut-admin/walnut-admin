# TypeScript 配置策略

> 大型 monorepo 中，tsconfig 不是一份文件，而是一个**分层配置体系**。本文档总结业界主流做法，并分析其对 Walnut Admin 的适用性。

---

## 1. 业界共识：分层配置模型

大型 TypeScript monorepo 普遍采用 **三层结构**：

```
仓库根目录
├── tsconfig.base.json          ← Layer 1: 全仓库共享基线
├── apps/web/tsconfig.json      ← Layer 3: 消费方，extends layer 2
├── packages/config/
│   └── typescript/
│       ├── base.json           ← Layer 2a: 可发布的共享 base config
│       ├── vue.json            ← Layer 2b: 环境特定 config
│       └── node.json           ← Layer 2b: 环境特定 config
```

**核心原则：Configuration as dependency**——升级一次 config，所有 consumer 自动同步。

### 1.1 为什么不用 TypeScript Project References？

**业界结论：不推荐在 monorepo 中使用 TypeScript Project References。** 这与 Walnut Admin [ADR-0010](../adr/0010-no-ts-project-references.md) 的结论一致。

原因：
- **构建工具冲突**：Vite、SWC、esbuild 等构建器不理解 project references，直接忽略 `references` 字段
- **维护成本高**：需要在每个包的 tsconfig 中维护 `references` 数组，一旦 A→B→C 依赖链变化，三处都要改
- **增量构建伪收益**：Turbo 的缓存 + 任务编排已经解决了增量构建问题，TS project references 的增量编译优势被 Turbo 替代
- **编辑器性能问题**：大型 project references 图会导致 VS Code 的 TypeScript server 内存占用飙升

**替代方案**：通过 pnpm workspace + package `exports` 字段，让 TypeScript 通过 node_modules 符号链接解析类型，走标准的模块解析路径。

### 1.2 Walnut Admin 现状对照

| 方面 | 业界标准 | Walnut Admin | 差距 |
|------|---------|-------------|------|
| 根 tsconfig | `tsconfig.base.json`，全仓库共享 | ✅ `tsconfig.base.json` | 无 |
| config 包 | `@repo/typescript-config` 可发布的 config 包 | ❌ 没有 | 不需要——当前规模用 root base config 足够 |
| 后端 tsconfig | extends root base，`module: "commonjs"` | ✅ `apps/server/tsconfig.json` 独立 | 符合 ADR-0012 |
| source/declaration | `declaration: true` + `declarationMap: true` | ⚠️ 部分有 | `@walnut/contract` 有，其他 package 无 |
| noEmit 检查 | `tsc --noEmit` 作为独立的类型检查任务 | ✅ `types:check` 任务存在 | 无 |

---

## 2. tsconfig 选项详解

### 2.1 根基线配置

```jsonc
// tsconfig.base.json — 所有包的公共基线
{
  "compilerOptions": {
    // === 严格性 ===
    "strict": true,
    "noUncheckedIndexedAccess": true,     // 推荐：防止 arr[0] 忽略 undefined
    "exactOptionalPropertyTypes": false,  // 大多数项目关闭（Vue/NestJS 兼容性问题）

    // === 模块解析 ===
    "module": "ESNext",
    "moduleResolution": "bundler",         // 2024+ 推荐：Vite/esbuild 原生理解
    "esModuleInterop": true,
    "allowImportingTsExtensions": true,    // 允许 import "./foo.ts"（Vite 需要）

    // === 产物 ===
    "declaration": true,
    "declarationMap": true,                // 消费者可以 jump to source
    "sourceMap": true,

    // === 约束 ===
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,               // Vite/SWC/esbuild 的前提条件
    "skipLibCheck": true,                  // 跳过 node_modules 的类型检查

    // === 新语法 ===
    "target": "ES2022",
    "lib": ["ES2022"],

    // === 路径 ===
    "baseUrl": ".",
    // 注意：不在 base config 中声明 paths！
    // paths 由每个包的 tsconfig.json 自己声明
  }
}
```

### 2.2 关键选项决策树

| 如果你的场景是... | 那么... |
|-------------------|---------|
| 全部 ESM | `"module": "NodeNext"` + `"moduleResolution": "NodeNext"` |
| Vite/esbuild 构建 | `"moduleResolution": "bundler"` + `"allowImportingTsExtensions": true` |
| CJS 后端 (NestJS) | `"module": "commonjs"` + `"moduleResolution": "node"` |
| 发布到 npm | `"declaration": true` + `"declarationMap": true` |
| 内部 only（不发布） | 可省略 declaration，但**建议保留**（编辑器体验更好） |
| 使用枚举 | 开启 `"isolatedDeclarations": false`（否则每个 enum 需单独声明文件） |

### 2.3 异构工具链的分层策略

Walnut Admin 同时包含 **ESM/Vite（前端）** 和 **CJS/SWC（后端）** 两套构建体系。业界推荐做法（参考 CSS-Tricks、Sentry、Vercel 等工程团队的公开文档）：

```jsonc
// tsconfig.base.json        ← 纯语言级选项（strict、target、lib）
{
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "lib": ["ES2022"],
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true
  }
}
```

```jsonc
// apps/admin/tsconfig.json   ← 前端：extends base + 前端专用选项
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "jsx": "preserve",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

```jsonc
// apps/server/tsconfig.json  ← 后端：extends base + 后端专用选项
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "commonjs",
    "moduleResolution": "node",
    "declaration": true,
    "outDir": "./dist",
    "paths": {
      "@walnut-server/config/*": ["./libs/config/src/*"],
      "@walnut-server/db/*": ["./libs/db/src/*"]
    }
  }
}
```

**关键原则**：`tsconfig.base.json` 只放**与模块系统无关**的纯语言级选项。`module` / `moduleResolution` / `jsx` 由每个 app/package 自己声明。

---

## 3. 共享 config 包 vs 根 base 文件

### 3.1 什么时候用共享 config 包

| 条件 | 根 base 文件 | 共享 config 包 (`@repo/tsconfig`) |
|------|-------------|----------------------------------|
| 包数量 | < 10 个 | 10+ 个 |
| 外部使用者 | 无 | 有（如 micro-frontend 的远程模块） |
| 需要版本管理 | 否 | 是 |
| 多个品类 | 1 套 tsconfig | 多套（`base.json`, `vue.json`, `node.json`, `react.json`） |

### 3.2 共享 config 包的标准结构

```
packages/config/typescript/
├── package.json           ← `"name": "@repo/typescript-config"`
├── base.json              ← 全品类基础
├── vue.json               ← extends base，加 vue 专用选项
├── node.json              ← extends base，CJS + paths
└── library.json           ← extends base，declaration + sourceMap
```

```jsonc
// @repo/typescript-config/vue.json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "preserve",
    "allowImportingTsExtensions": true
  }
}
```

消费者：
```jsonc
// apps/admin/tsconfig.json
{
  "extends": "@repo/typescript-config/vue.json",
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src"]
}
```

> **Walnut Admin 当前不需要共享 config 包。** 包数量少（4 个 packages + 2 个 apps），root base 足够。如果未来 packages 扩展到 10+ 或者需要给外部团队提供 tsconfig preset，再考虑提取。

---

## 4. TypeScript 版本管理

### 4.1 业界做法

| 策略 | 做法 | 适用场景 |
|------|------|---------|
| **全局统一** | pnpm catalog 锁定一个 TS 版本，所有包用同一个 | 绝大多数 monorepo（推荐） |
| **独立版本** | 每个包声明自己的 TS 版本 | 仅 1-2 个包，且工具链差异极大 |
| **逐步升级** | 通过 pnpm overrides 临时 pin TS 版本 | 过渡期做法 |

### 4.2 推荐：catalog 统一锁定

```yaml
# pnpm-workspace.yaml
catalog:
  typescript: ^6.0.0
```

```json
// 每个包的 devDependencies
{
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```

**好处**：
- 升级 TypeScript 只需改 `pnpm-workspace.yaml` 一行
- 避免不同包使用不同 TS 版本导致的类型不兼容
- Dependabot/Renovate 可以自动提 catalog 更新 PR

---

## 5. 类型检查作为 CI 门禁

### 5.1 标准做法

每个包都应有 `typecheck` 或 `types:check` script：

```json
{
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit"
  }
}
```

根 turbo.json：
```json
{
  "tasks": {
    "typecheck": {
      "dependsOn": ["^build"],   // 等依赖的 declaration 文件产出后再检查
      "outputs": []
    }
  }
}
```

### 5.2 CI 中的执行顺序

```
lint → typecheck → test → build
```

- **lint 第一**：最快，先抓掉低级错误
- **typecheck 第二**：比 test 快，不需要运行时
- **test 第三**：最慢，只在前面都过了才跑
- **build 最后**：前面全过门了才构建产物

```bash
# CI 一键运行
turbo run lint typecheck test build --filter='[origin/main]'
```

### 5.3 前端 vs 后端的差异化

| 任务 | 前端 (Vite) | 后端 (NestJS) |
|------|------------|---------------|
| 类型检查 | `vue-tsc --noEmit`（检查 `.vue` 文件） | `tsc --noEmit` |
| 构建 | `vite build`（不单独跑 tsc） | `nest build`（SWC 编译 + 可选的 tsc 检查） |
| declaration | 不产生 | 产生（供前端消费） |

> **注意**：Vite 在构建时不执行类型检查——只做语法转换。因此前端必须单独跑 `vue-tsc --noEmit`。这是 Vite 生态的标准做法，不是缺陷。

---

## 6. 常见陷阱与反模式

| 反模式 | 为什么是坑 | 正确做法 |
|--------|-----------|---------|
| `paths` 写在 root tsconfig | 子包的 tsconfig 会因为 `baseUrl` 覆盖而继承不到 | `paths` 只写在消费方的 tsconfig 中 |
| `composite: true` + Vite | Vite 不认识 `composite`，构建时直接忽略 | 不用 composite |
| 每个包一份完整 tsconfig | 改一个选项要改 N 个文件 | extends root base，只写差异 |
| `exclude: ["node_modules"]` 写在每个包 | 默认已排除，画蛇添足 | 不写（默认行为） |
| `types: ["node"]` 混用 | 前端项目不该有 node types | 需要 node types 的包自己声明 |
| 使用 `enum` + `isolatedDeclarations` | TS 7+ 的这个组合要求每个 enum 手写 .d.ts | 关闭 `isolatedDeclarations` 或改用 union types |

---

## 7. 实用命令速查

```bash
# 检查所有包的类型（不产出文件）
pnpm types:check

# 检查单个包
pnpm --filter @walnut/contract types:check

# 检查某个包及其所有依赖
turbo run typecheck --filter='@walnut/admin...'

# 只检查 git diff 变更的包
turbo run typecheck --filter='[origin/main]'

# 生成 tsconfig 的诊断信息
tsc --showConfig --project apps/admin/tsconfig.json

# 找出未使用的 tsconfig 选项
# 安装 @typescript-eslint/parser + eslint-plugin-ts-config
```

---

## 8. 与 Walnut Admin 的映射

| 本文建议 | Walnut Admin 现状 | 是否需要改 |
|---------|-------------------|-----------|
| 分层 tsconfig（base → environment → app） | ✅ 已有 `tsconfig.base.json` + 各自 extends | 无需 |
| 不用 TS Project References | ✅ ADR-0010 已决定 | 无需 |
| catalog 统一锁定 TS 版本 | ✅ ADR-0011 `catalogMode: strict` | 无需 |
| 类型检查作为 CI 门禁 | ⚠️ CI 中有 `types:check` 但未与 test/build 串联 | 参考 ADR-0009 |
| `declaration: true` 用于共享包 | ⚠️ 仅 `@walnut/contract` 有 | 按需加给其他需要被后端消费的包 |
| 后端 tsc 检查独立于 SWC | ✅ ADR-0012 已决定 | 无需 |
