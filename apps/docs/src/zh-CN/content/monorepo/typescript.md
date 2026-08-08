# TypeScript 配置

## 概述

Walnut Admin 是一个**异构工具链**的全栈 monorepo——前端用 ESM + Vite + `moduleResolution: "bundler"`，后端用 CJS + NestJS CLI + SWC。TypeScript 的配置策略需要同时兼容这两种截然不同的模块系统。

## 我们做了什么

### 1. 根 `tsconfig.base.json` 只放纯语言级选项

[`tsconfig.base.json`](https://github.com/walnut-admin/walnut-admin/blob/main/tsconfig.base.json) 是所有前端 workspace 包的共享基线：

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",     // Vite/esbuild 原生理解
    "strict": true,
    "isolatedModules": true,           // Vite/SWC 的前提条件
    "verbatimModuleSyntax": true,      // 强制区分 type import
    "skipLibCheck": true,              // 跳过 node_modules 类型检查
    "noEmit": true                     // 类型仅检查，不产出文件（Vite 负责构建）
  }
}
```

### 2. 前端包 extends root base

`apps/admin`、`packages/platform-web/client`、`packages/platform-web/http` 等前端包直接 extends root base，仅声明自己的 `include`/`paths`：

```jsonc
// apps/admin/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": { "@/*": ["./src/*"], "~/*": ["./types/*"] }
  }
}
```

### 3. 后端不 extends root base

`apps/server/tsconfig.json` 是**完全独立**的——不 extends `tsconfig.base.json`。原因：后端使用 CJS + `moduleResolution: "node"` + `experimentalDecorators`（NestJS 必需），与 root base 的 ESM + `bundler` 完全冲突：

| 选项 | root base（前端） | server（后端） |
|------|------------------|---------------|
| `module` | `ESNext` | `commonjs` |
| `moduleResolution` | `bundler` | `node` |
| `experimentalDecorators` | — | `true` |
| `emitDecoratorMetadata` | — | `true` |
| `noEmit` | `true` | `false`（SWC 需要 .js） |
| `verbatimModuleSyntax` | `true` | 与 CJS 不兼容 |

### 4. 不用 TypeScript Project References

[ADR-0010](/content/adr/0010-no-ts-project-references.md) 明确否决了 Project References。

原因：
- 异构工具链不兼容（bundler vs node 模块解析）
- Vite/VitePress 不读 `references` 字段
- 后端有自己的 tsconfig，不参与交叉引用
- Turbo 的 `dependsOn: ["^build"]` 已解决构建顺序问题，不需要 TS 层面的引用

### 5. 类型检查作为独立任务

| 任务 | 前端 | 后端 |
|------|------|------|
| 类型检查 | `vue-tsc --noEmit` | `tsc --noEmit` |
| 构建 | `vite build`（不做类型检查） | `nest build`（SWC 编译） |

根 `turbo.json` 中 `types:check` 和 `build` 是**两个独立任务**，互不影响。

## 没做什么 / 为什么

### 不提取共享 tsconfig 包（`@repo/tsconfig`）

当前有 6 个共享包（contract / types / utils-core / client / http / ui）+ 3 个 tooling 包（eslint-config / release / commitlint-config）+ 3 个 app 需要 tsconfig，root base + 各自 extends 已足够。提取成 `@walnut/tsconfig` 包的主要收益是版本控制和外部消费，当前规模下不需要。

### 不声明跨包 `paths`

按照 [ADR-0012](/content/adr/0012-toolchain-divergence.md)，`@walnut/contract` 和 `@walnut/utils` 在后端中通过 pnpm workspace symlink + `package.json` 的 `exports` 字段解析，不通过 tsconfig `paths`。这确保了开发环境和生产环境（如发布到 npm）的解析行为一致。

### 不直接参考后端的 tsconfig

后端的 `@walnut-server/*` 内部 lib 通过 tsconfig `paths` 映射（而非 pnpm workspace），这是它们唯一可行的解析方式——这些 lib 不是 pnpm workspace 包，没有 `package.json` 的 `exports` 字段。

---

## 相关 ADR

- [ADR-0010: No TypeScript Project References](/content/adr/0010-no-ts-project-references.md)
- [ADR-0012: Frontend-Backend Toolchain Divergence](/content/adr/0012-toolchain-divergence.md)
