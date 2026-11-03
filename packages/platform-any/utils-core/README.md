# `@walnut/utils`

> 两端**同源**的纯函数只剩两件：**`sign-raw`**（请求签名原文构造）与 **`object-paths`**
> （嵌套对象 ↔ 扁平 path）。判据是「两端是否对同一批字节 / 同一棵树负责」—— 各算各的必然漂移。
> 其余曾经住在这里的东西（regex、单例 Promise、crypto 常量与 base64 变换、存储加解密装饰器）
> **后端 0 消费**，2026-11 批次 4 起下沉到 `@walnut/client`（决策 D7）。

| | |
|---|---|
| 目录 | `packages/platform-any/utils-core` |
| 平台 / 运行时 | `platform: any` ｜ `type: utils` ｜ `runtime: none`（`package.json` 的 `walnut` 块） |
| 消费方式 | **双模**：前端 Vite 经 `source` / `import` 条件直读 `src/*.ts`；后端经 `require` 条件拿 `dist/*.cjs`（`vite build` 产出）。见 [ADR 0002](../../../apps/docs/src/zh-CN/content/adr/0002-dual-mode-consumption.md) |

> ⚠️ **目录名 ≠ 包名，这是有意的**：目录叫 `utils-core/`（ADR 0017 把当时的 `utils` 包拆成 `utils-core` + `types` 时留下的名字），包名从那时起一直是 **`@walnut/utils`**。写 `@walnut/utils-core` 会被 `pnpm lint:docs-refs` 判为「不存在的包名」拦下 —— 证据：`packages/tooling/scripts/src/ci/check-doc-refs.ts` 的豁免清单里专门写了这一条。

## 双端消费面（一句话）

**后端只消费两件事 —— 签名原文（`sign-raw`）与对象扁平化（`object-paths`），前端消费的是同一份实现**；
除此之外本包没有第三个消费方。这也是它留在 `packages/platform-any/` 的全部理由：两件事都是
「前后端必须逐字节 / 逐节点一致」的算法，而不是某一端的工具。

| 消费方 | 入口 | 用途 |
|---|---|---|
| `apps/server/libs/guards`（`sign.guard.ts` / `security.guard.ts`） | `@walnut/utils/sign-raw` | 校验请求签名（与前端算同一段原文） |
| `apps/server/libs/utils`（`general.ts` re-export） | `@walnut/utils/object-paths` | 审计日志的扁平化 diff |
| `apps/admin`（`store/modules/app/app-security.ts`） | `@walnut/utils/sign-raw` | 构造待签名原文（与后端逐字节同源） |
| `@walnut/client`（`browser/shared.ts` re-export） | `@walnut/utils/object-paths` | 前端同名的扁平化工具 |

## 它是什么

纯运行时逻辑，**不碰 Vue、DOM、Node 专有 API**，且 **2026-11 批次 4 · D7 之后零运行时依赖**
（原来的 `@walnut/contract` / `@walnut/types` / `js-base64` 三个依赖都随下沉搬到了 `@walnut/client`）。

边界：

- **「两端负责同一批字节 / 同一棵树」的算法进来**；只有一端在用的工具留在那一端 ——
  前端专属的进 `@walnut/client`，后端专属的进 `apps/server/libs/*`。
- **不引框架、不引第三方**：没有 `dependencies`。
- 依赖浏览器 API 的加密实现（`aesGcmEncrypt` 等）、crypto 常量与 base64 变换都在
  `@walnut/client` 的 `browser/crypto/{const,transformer}`，不在这里。

## 导出面

`exports` 的 `"."` 与 `"./*"` 与 `@walnut/contract` 同形（`source` / `types` / `import` → `src/*.ts`，`require` / `default` → `dist/*.cjs`）。子路径入口与 vite 构建条目**一一对应，现在只剩三个**：

| 入口 | 内容 |
|------|------|
| `.` | 下列全部导出（`src/index.ts`，选择性 barrel，ADR 0013） |
| `./object-paths` | `objectToPaths` / `pathsToObject`，类型 `ObjectToPathsOptions` / `PathRecord` |
| `./sign-raw` | `buildSignRaw` / `splitPathAndQuery` / `stripApiPrefix`，类型 `SignRawParts` |

> 加文件前先问一句：它是「两端负责同一批字节 / 同一棵树」吗？不是就别放进来 ——
> `vite.config.ts` 的 entries 表就是这条判据的物理形态（多一端专属的条目 = 判据被绕过了）。

## 怎么用

```ts
// ① 签名原文：前后端**必须**调同一个函数（各自手写一定会漂移，漂移的表现是 401 / 签名不符）
import { buildSignRaw, splitPathAndQuery } from '@walnut/utils/sign-raw'

export function signRawFor(method: string, url: string, body: unknown): string {
  const { path, query } = splitPathAndQuery(url)
  return buildSignRaw({ method, path, query, body })
}
```

```ts
// ② 扁平化：后端用它做审计日志的字段级 diff，前端用它做同名工具（同一棵树、同一批 key）
import { objectToPaths } from '@walnut/utils/object-paths'

export function flattenedKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(objectToPaths(payload))
}
```

## 依赖与边界

- **依赖**：**没有 `dependencies`**（D7 之后；原三个都随下沉搬走）。devDependencies：`@walnut/tsconfig`（`ts.json` 预设）、`@walnut/vitest-config`、`@walnut/eslint-config`、`typescript`、`vite`、`vite-plugin-dts`、`vitest`、`rimraf`、`@types/node`。测试链：`vitest` + `@walnut/vitest-config`（`vitest.config.ts` 一行 `defineWalnutVitestConfig()`）；`tsconfig.json` 继承 `@walnut/tsconfig/ts.json` 并自持 `types: ["node"]`。
- **消费者**：只有上表那四个入口名 —— `apps/server`（两个 guard + `libs/utils`）与前端两侧（`@walnut/admin` 的 `sign-raw`、`@walnut/client` 的 `object-paths` re-export）。crypto / regex / queue / enhance 的消费方**已随实现搬到 `@walnut/client`**。
- **边界由 turbo tags 强制**：workspace 级 `turbo.json` 声明 `shared` / `pure` / `platform-any`，根 `turbo.json` 的 `boundaries.tags` 禁止 `shared` 依赖 app、禁止 `platform-any` 依赖 `platform-web` / `platform-node`（`pure` 是描述性标签，无对应规则）。由 `pnpm boundaries` 拦。
- **测试**：4 个 `*.test.ts`（`object-paths` / `sign-raw` 各自的对拍用例），与源文件同级；原来的 regex / queue / transformer / enhance 用例随实现一起搬进了 `@walnut/client`（`pnpm --filter @walnut/client test` 跑）。

## 已知限制与延后工作

- **`sign-raw` 的 CJS 面是签名真源的唯一去处**：后端两个 guard 经 `require` 条件拿 `dist/sign-raw.cjs`，所以没跑过 `pnpm build`（或 CI 的 `turbo run build --filter=@walnut/utils`）时，openapi 导出会 `Cannot find module` —— 这是**产物面**依赖，别用「源码直消费」的直觉推断它。
- **曾经的 contract 内联问题随 D7 消失**：老版本把 `@walnut/contract/crypto-wire` 打进产物（构建期快照而非引用），根因是 `crypto/const.ts` 住在这里；该文件已搬到 `@walnut/client`，本包现在**不 import 任何 workspace 包**，产物面只有自己的三个条目。
- **server 侧纯函数部分上收（U3 批）**：`objectToPaths` / `pathsToObject` 已迁入本包（server 与 client 双端 re-export 消费）；`generateVerifyCode` / `sleep` / `regexMap` / `maskEmail` / `maskPhone` / `maskSensitiveFields` / `getPackageJsonData` / `AppDayjs` 仍为 server 专属（无跨端消费或 Nest/Node 耦合）。
- **构建产物包含测试文件的声明**：dts 插件配置为 `include: ['src']`，`*.test.ts` 的 `.d.ts` 会一起产出（`types` 字段指向 `src`，所以当前无害，但产物面比公开面大）—— 证据：`packages/platform-any/utils-core/vite.config.ts`。
- **`test` 脚本带 `--passWithNoTests`**：历史上曾经真的没有用例；现在有 4 个，开关留着无害 —— 证据：`packages/platform-any/utils-core/package.json`。
- **同源候选已按判据重判**：`LRUMap<K, V>` 与 `extractJSON` / `isBufferWaitingForJSON`（还在 `apps/admin/src/components/Global/AI/utils/` 下）只有前端消费，按本包现在的判据**不进这里**（ADR 0017 当时写的是「可选择性放入」）。

## 相关

- [架构地图 · 共享包体系](../../../apps/docs/src/zh-CN/content/monorepo/architecture.md)（依赖图 / 各包职责 / 消费方式）
- [架构待办事项](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)（A6 server 死依赖决策）
- ADR：[0002 双模式消费](../../../apps/docs/src/zh-CN/content/adr/0002-dual-mode-consumption.md) ｜ [0005 JIT vs 构建](../../../apps/docs/src/zh-CN/content/adr/0005-jit-vs-build.md) ｜ [0013 Barrel 策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md) ｜ [0017 包重组](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- 相关包：[`@walnut/client`](../../platform-web/client/README.md) ｜ [`@walnut/types`](../types/README.md) ｜ [`@walnut/contract`](../contract/README.md) ｜ [`@walnut/vitest-config`](../../tooling/vitest-config/README.md)
- 决策记录：批次 4 · D7（`@walnut/utils` 收缩到两件事）+ D6（`@walnut/types` 归前端）
