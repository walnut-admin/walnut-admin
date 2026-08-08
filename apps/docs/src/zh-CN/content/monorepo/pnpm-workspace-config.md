# pnpm-workspace.yaml 配置详解

> 本文档逐项解释 `pnpm-workspace.yaml` 和 `.npmrc` 中的每一个配置项——它是什么、为什么这么配、改了会怎样。

---

## pnpm-workspace.yaml

### `catalogMode: strict`

```yaml
catalogMode: strict
```

`package.json` 中的依赖必须用 `"catalog:"` 引用，不能直接写版本号。违反则在 `pnpm install` 时报错。

**为什么**：阻止 `pnpm add` 不加 `--save-catalog` 引入依赖，防止版本漂移。

### `packages`

```yaml
packages:
  - 'apps/*'
  - 'packages/platform-any/*'
  - 'packages/platform-web/*'
  - 'packages/tooling/*'
```

声明哪些目录是 pnpm workspace 成员。`apps/` 下 3 个应用 + `packages/` 下按平台分组的 9 个包（`platform-any` 纯逻辑包、`platform-web` 前端包、`tooling` 工具链包），共 12 个 workspace 包。

### `hoisting: false`

```yaml
hoisting: false
```

关闭 pnpm 默认的依赖提升行为。默认（`hoisting: true`）时，依赖会尽量提升到**根 `node_modules/`**（跨包去重共享同一份副本）；`node_modules/.pnpm/` 是 pnpm 的**虚拟 store**，存放未提升的精确版本副本。设为 `false` 后不做提升，每个包只能访问自己 `package.json` 中声明的依赖。

**为什么**：严格的依赖隔离。不会出现"包 A 没声明 `lodash` 但能 import 到"的幽灵依赖（phantom dependency）问题。

**例外**：5 个工具链包需要在 `.npmrc` 中通过 `public-hoist-pattern` 提升到根 `node_modules`（见下文）。

### `overrides`

```yaml
overrides:
  glob: 11.1.0
```

强制整个依赖树中 `glob` 统一为指定版本。无论间接依赖声明了 `glob@10.x` 还是 `glob@9.x`，pnpm 只用 `11.1.0`。

**为什么**：`glob` 是极底层的工具库，被大量间接依赖引用。不统一版本会装多份，浪费空间 + 可能运行时冲突。`lru-cache` 此前也在 overrides 中强制，现已被 catalog 精确锁定（11.3.6），从 overrides 移除。

### `minimumReleaseAgeExclude`

```yaml
minimumReleaseAgeExclude:
  - '@dotenvx/dotenvx@2.19.0'
  - '@dotenvx/primitives@2.1.1'
```

pnpm 的安全机制：新发布的包要等一段"冷却期"才能安装（防止供应链攻击——恶意包被发现前有时间窗口）。这两个 `@dotenvx` 包发布频繁，不加白名单 CI 的 `pnpm install` 会报错。

**为什么只排这两个**：它们是项目中唯一频繁发布的包。排除的是**精确版本号**（`@2.19.0`），不影响其他版本的安全检查。

### `allowBuilds`

pnpm 默认禁止包执行 `postinstall` 脚本（安全措施）。`allowBuilds` 白名单允许特定包执行。

```yaml
allowBuilds:
  '@alicloud/openapi-core': true  # 阿里云 SDK，需要 postinstall
  '@compodoc/compodoc': true      # NestJS 文档生成器
  '@nestjs/core': true            # NestJS 核心，需要编译原生扩展
  '@parcel/watcher': true         # 文件监听原生模块
  '@scarf/scarf': true            # 匿名使用统计（可选）
  '@sentry/cli': true             # Sentry 错误追踪 CLI
  '@swc/core': true               # SWC 编译器，Rust 原生模块
  core-js: true                   # Polyfill 库
  esbuild: true                   # Go 原生模块（Vite/Vitest 编译引擎）
  json-editor-vue: true           # JSON 编辑器组件
  msgpackr-extract: true          # 序列化库原生模块
  rs-module-lexer: true           # Rust 模块解析器
  sharp: true                     # 图片处理（libvips 原生模块）
  simple-git-hooks: true          # Git hooks 管理器
  unrs-resolver: true             # Rust 路径解析器
  vue-demi: true                  # Vue 2/3 兼容层
```

| 类别 | 包 | 为什么需要 |
|------|-----|-----------|
| 原生编译 | `@swc/core`, `esbuild`, `sharp`, `@parcel/watcher` | Rust/Go/C++ 原生模块，必须编译才能用 |
| 框架核心 | `@nestjs/core` | NestJS 依赖注入引擎 |
| 工具链 | `simple-git-hooks`, `@compodoc/compodoc`, `@sentry/cli` | Git hooks / 文档生成 / 错误上报 |
| 云 SDK | `@alicloud/openapi-core` | 阿里云 API 调用 |
| Polyfill | `core-js` | 浏览器兼容性 |
| 兼容层 | `vue-demi` | Vue 2/3 双版本兼容 |
| 序列化 | `msgpackr-extract`, `unrs-resolver`, `rs-module-lexer` | Rust 原生模块，性能优化 |
| 组件 | `json-editor-vue` | JSON 编辑器 |
| 统计 | `@scarf/scarf` | 可选匿名使用统计 |

---

## .npmrc

### `strict-peer-dependencies=true`

peerDependencies 版本不匹配时 `pnpm install` 直接报错。

### `engine-strict=true`

`package.json` 中 `engines.node >= 24.13.0` 不满足时拒绝安装。

### `save-exact=true`

`pnpm add` 默认保存精确版本（不用 `^` 前缀）。配合 catalog 使用。

### `public-hoist-pattern[]`

```ini
public-hoist-pattern[]=*turbo*
public-hoist-pattern[]=*eslint*
public-hoist-pattern[]=*simple-git-hooks*
public-hoist-pattern[]=*@swc*
public-hoist-pattern[]=*esbuild*
```

将匹配的包从 `node_modules/.pnpm/` 提升到根 `node_modules/`。仅用于**必须在根目录运行的 CLI 工具**。

| 模式 | 提升的包 | 原因 |
|------|---------|------|
| `*turbo*` | `turbo` | 根目录执行 `turbo run` |
| `*eslint*` | `eslint` + 插件 | 统一 ESLint 配置解析 |
| `*simple-git-hooks*` | `simple-git-hooks` | 根 `postinstall` 注册 hooks |
| `*@swc*` | `@swc/core`, `@swc/cli` | Server SWC 编译器 |
| `*esbuild*` | `esbuild` | Vite、vitest、tsx 共用 |

---

## 相关文档

- [pnpm Catalog](./pnpm-catalog.md) — catalog 详细用法
- [ADR-0012: Toolchain Divergence](../adr/0012-toolchain-divergence.md) — hoisting 和 public-hoist-pattern 的决策背景
- [ADR-0011: Dependency Governance](../adr/0011-dependency-governance-release.md) — catalogMode strict 的决策背景
