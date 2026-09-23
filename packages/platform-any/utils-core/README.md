# `@walnut/utils`

> 平台无关的**纯函数工具**：正则校验、单例 Promise 队列、字节 / Base64 / Hex / UTF-8 转换、crypto 常量，以及给任意 `Storage` 套一层透明加解密的装饰器。

| | |
|---|---|
| 目录 | `packages/platform-any/utils-core` |
| 平台 / 运行时 | `platform: any` ｜ `type: utils` ｜ `runtime: none`（`package.json` 的 `walnut` 块） |
| 消费方式 | **双模**：前端 Vite 经 `source` / `import` 条件直读 `src/*.ts`；后端经 `require` 条件拿 `dist/*.cjs`（`vite build` 产出）。见 [ADR 0002](../../../apps/docs/src/zh-CN/content/adr/0002-dual-mode-consumption.md) |

> ⚠️ **目录名 ≠ 包名，这是有意的**：目录叫 `utils-core/`（ADR 0017 把当时的 `utils` 包拆成 `utils-core` + `types` 时留下的名字），包名从那时起一直是 **`@walnut/utils`**。写 `@walnut/utils-core` 会被 `pnpm lint:docs-refs` 判为「不存在的包名」拦下 —— 证据：`packages/tooling/scripts/src/ci/check-doc-refs.ts` 的豁免清单里专门写了这一条。

## 它是什么

纯运行时逻辑，**不碰 Vue、DOM、Node 专有 API**（`TextEncoder` / `TextDecoder` / `Uint8Array` 这类双运行时全局除外）。内容分三类：原 `utils` 包的运行时代码、`@walnut/contract` wire 常量的消费方、给平台包复用的 storage 装饰器。

边界：

- **纯函数与常量**进来；类型声明去 `@walnut/types`，共享契约（错误码 / 路由 / wire format 常量）去 `@walnut/contract` —— 本包的 `AES_GCM` 就是从 contract 的 `AES_GCM_WIRE` 派生的，不另立一份。
- **不引框架**：`dependencies` 只有 `@walnut/contract`、`@walnut/types`、`js-base64`。
- 依赖浏览器 API 的加密实现（`aesGcmEncrypt` 等）在 `@walnut/client`，不在这里。

## 导出面

`exports` 的 `"."` 与 `"./*"` 与 `@walnut/contract` 同形（`source` / `types` / `import` → `src/*.ts`，`require` / `default` → `dist/*.cjs`）。子路径入口与 vite 构建条目一一对应：

| 入口 | 内容 |
|------|------|
| `.` | 下列全部导出（`src/index.ts`，选择性 barrel，ADR 0013） |
| `./regex` | `isEmailAddress` / `isPhoneNumber`（均为 `(value: string) => boolean`，两个正则都做了全锚定） |
| `./queue` | `SingletonPromise<T>` —— `new SingletonPromise(clearOnFinally?)` + `.run(task)` 并发去重 |
| `./crypto/const` | `AES_GCM` / `RSA_OAEP` / `PEM` 常量，以及 `PEMKeyType` / `CryptoResult<T>` / `AesGcmRawInput` / `AesGcmRawResult` / `RsaKeyPairPEM` 类型 |
| `./crypto/transformer` | `arrayBufferToBase64` / `uint8ArrayToBase64` / `base64ToUint8Array` / `base64ToArrayBuffer` / `uint8ArrayToHex` / `arrayBufferToHex` / `hexToUint8Array` / `utf8ToUint8Array` / `uint8ArrayToUtf8` |
| `./persistent/enhance/sync` | `withSyncConditionalEncryption(storage, crypto, shouldEncrypt)` |
| `./persistent/enhance/async` | `withAsyncConditionalEncryption(storage, crypto, shouldEncrypt)` |

## 怎么用

```ts
// ① 并发去重：同一个任务只跑一次，其余调用复用同一个 Promise
//    （apps/admin 的 axios 响应拦截器就是这么拿 sign / refresh token 的）
import { SingletonPromise } from '@walnut/utils/queue'

const signQueue = new SingletonPromise<string | null>()

export function getSignAesKey(): Promise<string | null> {
  return signQueue.run(async () => {
    return await loadSignAesKey()
  })
}

declare function loadSignAesKey(): Promise<string | null>
```

```ts
// ② 表单校验：国际手机号需要自己拼国家码（apps/admin 的登录 / 安全设置页用法）
import { isEmailAddress, isPhoneNumber } from '@walnut/utils/regex'

export function validateEmail(value: string): boolean {
  return isEmailAddress(value)
}

export function validatePhone(countryCallingCode: string, value: string): boolean {
  return isPhoneNumber(`+${countryCallingCode}${value}`)
}
```

```ts
// ③ 给任意 Storage 套一层透明加解密（packages/platform-web/client 的真实用法：
//    那里传的是 aesGcmEncrypt / wbtoa，这里用 btoa / atob 示意同样的形状）
import type { IStorageSync } from '@walnut/types/storage'
import { withSyncConditionalEncryption } from '@walnut/utils/persistent/enhance/sync'

export function encryptedStorage(base: IStorageSync, force: boolean): IStorageSync {
  return withSyncConditionalEncryption(base, {
    encrypt: plain => btoa(plain),
    decrypt: encoded => atob(encoded),
  }, () => force)
}
```

## 依赖与边界

- **依赖**：`@walnut/contract`、`@walnut/types`（都是 `workspace:*`）、`js-base64`（`catalog:`）。测试链：`vitest` + `@walnut/vitest-config`（`vitest.config.ts` 一行 `defineWalnutVitestConfig()`）；`tsconfig.json` 继承 `@walnut/tsconfig/ts.json` 并自持 `types: ["node"]`。
- **消费者**：`@walnut/client`（storage 装饰器 + crypto 转换器）与 `@walnut/admin`（`./queue`、`./regex`、`./crypto/transformer`）。**`apps/server` 目前不消费本包**（见下）。
- **边界由 turbo tags 强制**：workspace 级 `turbo.json` 声明 `shared` / `pure` / `platform-any`，根 `turbo.json` 的 `boundaries.tags` 禁止 `shared` 依赖 app、禁止 `platform-any` 依赖 `platform-web` / `platform-node`（`pure` 是描述性标签，无对应规则）。由 `pnpm boundaries` 拦。
- **测试**：5 个 `*.test.ts`（`regex` / `queue` / `crypto/transformer` / `persistent/enhance` 的 sync + async），与源文件同级。

## 已知限制与延后工作

- **CJS 面当前没有消费者**：`require` / `main` 两个条件指向的 `dist/*.cjs` 无人 import —— `apps/server` 已不声明本依赖（A6 核实记录：`apps/server` 无 `@walnut/utils` 声明、`git grep` → 0），ADR 0017 的 Phase 2.4「确认死依赖处理（使用或移除声明）」以**移除**告终、勾选框至今未勾 —— 证据：`apps/docs/src/zh-CN/content/monorepo/architecture-todo.md` 与 `apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md`。
- **CJS 产物把 contract 的 wire 常量内联了**：`vite.config.ts` 的 `rollupOptions.external` 只列了 `js-base64`，于是 `@walnut/contract/crypto-wire` 被打进产物（构建产物里是一份字面量 `{ IV_LENGTH: 12, TAG_LENGTH: 16, MIN_PAYLOAD_LENGTH: 28 }`）—— 这个「前后端必须一致」的有线格式在产物面成了构建期快照，而不是对 contract 的引用。证据：`packages/platform-any/utils-core/vite.config.ts`。
- **server 侧的纯函数一项都没迁进来**：ADR 0017 的迁入清单（`generateVerifyCode` / `sleep` / `objectToPaths` / `regexMap` / `maskEmail` / `maskPhone` / `maskSensitiveFields` / `getPackageJsonData` / `AppDayjs`）全部未执行 —— 决策 5 记为「2026-07-31 评估后跳过：`libs/utils` 被 73 个文件引用」，这些函数仍在 `apps/server/libs/utils/src/`。证据：`apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md`。
- **同源候选未定案**：`LRUMap<K, V>` 与 `extractJSON` / `isBufferWaitingForJSON` 在 ADR 0017 里只写「**可选择性**放入 `utils-core`」，至今仍在 `apps/admin/src/components/Global/AI/utils/` 下 —— 证据：同一篇 ADR 的可选迁移候选表。
- **构建产物包含测试文件的声明**：dts 插件配置为 `include: ['src']`，`*.test.ts` 的 `.d.ts` 会一起产出（`types` 字段指向 `src`，所以当前无害，但产物面比公开面大）—— 证据：`packages/platform-any/utils-core/vite.config.ts`。
- **`test` 脚本带一个永不触发的开关**：`vitest run --passWithNoTests`，而包内实有 5 个测试文件 —— 证据：`packages/platform-any/utils-core/package.json`。

## 相关

- [架构地图 · 共享包体系](../../../apps/docs/src/zh-CN/content/monorepo/architecture.md)（依赖图 / 各包职责 / 消费方式）
- [架构待办事项](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)（A6 server 死依赖决策）
- ADR：[0002 双模式消费](../../../apps/docs/src/zh-CN/content/adr/0002-dual-mode-consumption.md) ｜ [0005 JIT vs 构建](../../../apps/docs/src/zh-CN/content/adr/0005-jit-vs-build.md) ｜ [0013 Barrel 策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md) ｜ [0017 包重组](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- 相关包：[`@walnut/types`](../types/README.md) ｜ [`@walnut/contract`](../contract/README.md) ｜ [`@walnut/vitest-config`](../../tooling/vitest-config/README.md)
