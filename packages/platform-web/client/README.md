# `@walnut/client`

> 浏览器 API + Vue composables + Pinia store 工厂 —— 前端唯一允许直接碰 DOM / Web Crypto / IndexedDB 的共享包。

| | |
|---|---|
| 目录 | `packages/platform-web/client` |
| 平台 / 运行时 | `platform: web` · `type: client` · `runtime: dom` + `web-crypto` + `vue`（`package.json` 的 `walnut` 块） |
| 消费方式 | 纯源码直消费（JIT）：`exports` 直接指向 `src/*.ts`，**没有构建步骤**（`build` 只是一句 `echo`，turbo 任务显式声明空 `outputs`） |

## 它是什么

`src/` 按「需要哪种运行时 API」分块（ADR 0006），这是本包最该被记住的一件事：

- `browser/` —— 只用浏览器 API、**不依赖 Vue**：`crypto/`（RSA-OAEP / AES-GCM / HMAC-SHA256 / HKDF 的 Web Crypto 包装 + `const.ts` 算法常量 + `transformer.ts` 字节/Base64/Hex/UTF-8 变换）、`file/`（base64 ↔ Blob、四个下载函数）、`cookie.ts`、`window/base64.ts`、`shared.ts`（设备与浏览器能力探测，并 re-export `@walnut/utils/object-paths`）
- `hooks/` —— Vue composable：`core/`（`useState` / `useProps` / `useContext` / `useLocalRefresh`）、`vueuse/`（vueuse 薄封装）、`web/`、`component/`
- `persistent/` —— 存储子系统：`storage/`（sync / async 两个与 `ref` 同形的 composable）、`idb/`（存在 IndexedDB 里的 AES-GCM 主密钥）、`enhance/`（AES-GCM / Base64 增强层；`async.ts` / `sync.ts` 是给任意 `Storage` 套透明加解密的装饰器，2026-11 从 `@walnut/utils` 搬来）
- `store/` —— `createWalnutStore()`，把「setup 内 / setup 外都要能取到 store」的样板收成一处
- `timer/`、`types/` —— 长延时定时器（绕开 `setTimeout` 上限）、Vue 专属类型声明（`.d.ts`）
- `queue.ts`、`regex.ts` —— 顶层单文件：`SingletonPromise<T>`（并发去重）与 `isEmailAddress` / `isPhoneNumber`（全锚定）。**这两个与环境无关，但只有前端消费**，2026-11 批次 4（决策 D7）从 `@walnut/utils` 下沉到这里 —— 不要因为它们「看起来像纯函数」又把它们上提到 platform-any。

**边界**：只有**两端对同一批字节 / 同一棵树负责**的算法才进 `@walnut/utils`（2026-11 起只剩 `sign-raw` 与 `object-paths`，见决策 D7）—— 「纯函数」本身不再是上提的理由；跨端共享的类型与常量进 `@walnut/types` / `@walnut/contract`；HTTP 机制进 `@walnut/http`；UI 组件留在 `apps/admin`（2026-11 起不再有 `@walnut/ui` 包）。本包不能被 `@walnut/server` 引用 —— turbo 边界（`backend` → deny `platform-web`）与 ESLint（`@walnut/eslint-config/nest` 的 `no-restricted-imports`）各拦一道。

## 导出面

| 入口 | 指向 | 内容 |
|---|---|---|
| `./*` | `src/*.ts` | 逐文件子路径 —— **这就是本包的公共面**：`@walnut/client/browser/cookie`、`@walnut/client/persistent/storage/sync` … |
| `./types/*` | `src/types/*.d.ts` | 纯类型子路径（`types/vue-ref`、`types/vue-object-key`） |

**没有桶入口**（`.`）：2026-11 批次 4 删掉了 `src/index.ts`（决策 D8、ADR 0013 修订）。
判据不是「桶本身好或不好」，而是「有没有真实消费者」—— 那个 barrel 的 54 个导出在全仓的
裸包名 import 站点是 **0**（admin 一律走子路径），所以它不构成公共面，只是一个会误导
`knip` 的「假入口」。子路径才是有消费者的那一面：

| 分组 | 代表导出（经子路径取） |
|---|---|
| `browser/cookie` | `Cookie` 类 + `getCookie` / `setCookie` / `removeCookie` |
| `browser/crypto/**` | `aesGcmEncrypt` / `aesGcmDecrypt`、`generateAes256Key`、`generateRsaOaepKeyPair`、`deriveApiSignKey`、`hmacSha256`、`importRsaPublicKey`、`importAesKeyFromRaw` / `exportAesKeyToRaw` |
| `browser/file/**` | `base64ToBlob` / `blobToBase64` / `imgUrlToBase64`、`downloadByBlob` / `downloadByBase64` / `downloadByUrl` / `downloadByOnlineUrl` |
| `browser/shared` + `browser/window/base64` | `detectDeviceType`、`getBoolean`、`getFunctionBoolean`、`getCPUCoreCount`、`getMemoryGB`、`getGPUArchitecture`、`getIsInIncognitoMode`、`isInSetup`、`getDefaultSlotText`、`watob` / `wbtoa` |
| `hooks/**` | `useState`、`useProps`（+ 类型 `IHooksUseProps`）、`useContext`、`localRefreshFlag` / `toggleLocalRefreshFlag`、vueuse 薄封装（`useSharedBattery` / `useSharedNetwork` / `useWindowResize` …）、`useBlob`、`useLinkTag`、`useGlobalAsyncComponent` |
| `persistent/**` | `enhancedAesGcmLocalStorage`、`enhancedBase64LocalStorage`、`getStorageIdbKey`、`removeStorageItemsContaining` |
| `store/createWalnutStore` | `createWalnutStore` |

## 怎么用

```ts
// 1. 与 ref 同形：初值取自 localStorage，之后 deep watch + 防抖写回
import { useAppStorageSync } from '@walnut/client/persistent/storage/sync'

const scrollTop = useAppStorageSync<Record<string, number>>('scroll-top', {})
scrollTop.value.dashboard = 320
```

```ts
// 2. 桶入口：Web Crypto 的 AES-256-GCM（默认产出 iv|ciphertext|tag 的 Base64）
import { aesGcmDecrypt, aesGcmEncrypt, generateAes256Key } from '@walnut/client'

const key = await generateAes256Key()
const cipher = await aesGcmEncrypt(key, 'hello')
const plain = await aesGcmDecrypt(key, cipher) // 解不开时返回 null，不抛
```

```ts
// 3. store 工厂：setup 内用当前实例，setup 外回落到传入的 pinia
import { createWalnutStore } from '@walnut/client'
import { createPinia } from 'pinia'
import { ref } from 'vue'

const pinia = createPinia()

export const useCounterStore = createWalnutStore('counter', pinia, () => {
  const count = ref(0)
  return { count }
})
```

## 依赖与边界

- **运行期依赖**：`@vueuse/core`、`@walnut/contract`（`browser/crypto/const.ts` 从 `AES_GCM_WIRE` 派生算法常量）、`@walnut/types`、`@walnut/utils`（只剩 `object-paths` 一个入口）、`detectincognitojs`、`easy-fns-ts`、`idb`、`js-base64`（`browser/crypto/transformer.ts`）、`lodash-es`、`superjson`（版本一律经 `catalog:`）。
- **peerDependencies**：`vue` + `pinia` —— 单例由宿主 app 提供；2026-08-08 从 `dependencies` 移入 peer。
- **谁依赖它**：`@walnut/admin`（`workspace:*`）。它自己既不依赖 `@walnut/http`，也不依赖 admin 的组件树。
- **turbo 标签**：`shared` + `platform-web` —— `shared` 不得依赖任何 app 包，`platform-any` / `platform-node` 不得依赖 `platform-web`。

## 已知限制与延后工作

- **store 工厂零消费者（A10）**：`createWalnutStore()` 目前只在包内出现（`src/store/createWalnutStore.ts`；它原来还从桶入口导出一份，桶已于 D8 删除），admin 侧的 store 文件 0 处使用 —— 待办 A10；`apps/admin/AGENTS.md` 也写着「新 store 请优先用它，别再复制模式」。
- **用例面很窄**：`vitest.config.ts`（jsdom + `@vitejs/plugin-vue`）与 `test: vitest run --passWithNoTests` 都在，但包内只有 `src/browser/__tests__/shared.test.ts` 一个用例文件（覆盖 `browser/shared.ts` 的纯函数面，D7 下沉后与 `@walnut/utils` 的同源断言仍在这里对拍）；ADR 0015 给本包定的覆盖率目标是 80%，离得更远的是用例数量而不是配置。
- **`browser/shared.ts` 混了两类东西**：`detectDeviceType` / `getCPUCoreCount` 需要浏览器，而 `getBoolean` / `getFunctionBoolean` / `objectToPaths` / `pathsToObject` 是纯函数 —— ADR 0017 §4「已知问题」记的就是这条（Phase 2 可考虑分离）。
- **ADR 0017 §4 的「从 apps/admin 迁入」清单没走完**：`utils/persistent/migrate.ts`（`setupStorageMigrations()`）、`utils/window/open.ts`（仍直接 import `@/router/routes/mainout`）、`hooks/component/useCountdown.ts`、`hooks/component/useDriver.ts` 至今留在 admin —— 对照 ADR 0017 §4 的迁入表与实际文件位置；同表中 `Cookie` 一条已完成（admin 只剩一行重导出）。
- **持久化载荷里的 `_v` 没有消费方**：`storage/{sync,async}.ts` 写入时都记 `_v: version`（包版本），但读回只解析 `v` 与 `e`（过期时间），全仓对 `_v` 只有这两处写入 + 类型声明 —— 也就是说跨版本迁移仍由 admin 的 `utils/persistent/migrate.ts` 承担，而它正是上面那条未迁入的清单成员。
- **`./types/*` 只能 `import type`**：该子路径映射到 `src/types/*.d.ts`，运行时 import 会落到没有 JS 产物的文件；要取值就走 `./*`。

## 相关

- [ADR 0005：前端 only 走 JIT、共享包走 CJS 构建](../../../apps/docs/src/zh-CN/content/adr/0005-jit-vs-build.md)
- [ADR 0006：按运行时 API 分层](../../../apps/docs/src/zh-CN/content/adr/0006-runtime-api-separation.md)
- [ADR 0013：桶导出策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md)
- [ADR 0015：测试策略](../../../apps/docs/src/zh-CN/content/adr/0015-testing-strategy.md)
- [ADR 0017：Package 重组（§4 是本包）](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- [Monorepo 架构总览](../../../apps/docs/src/zh-CN/content/monorepo/index.md) ｜ [架构待办（A10）](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)
- [apps/admin 指引](../../../apps/admin/AGENTS.md)（store 与组件约定）
