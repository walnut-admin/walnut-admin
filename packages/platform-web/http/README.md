# `@walnut/http`

> 基于 axios 的 HTTP 客户端框架：一个薄实例包装 + 一条可组合的 adapter 链。**原名 `@walnut/axios`，2026-07 随 ADR 0017 更名为 `@walnut/http`**（目录也从原来的 packages/axios/ 迁到 `packages/platform-web/http/`）。

| | |
|---|---|
| 目录 | `packages/platform-web/http` |
| 平台 / 运行时 | `platform: web` · `type: http` · `runtime: dom` + `vue`（`package.json` 的 `walnut` 块） |
| 消费方式 | 纯源码直消费（JIT）：`exports` 指向 `src/*.ts`，**没有构建步骤**（`build` 只是一句 `echo`，turbo 任务显式声明空 `outputs`） |

## 它是什么

- `instance.ts` —— `Axios` 类：`axios.create()` + 四个拦截器挂载点（`requestInterceptors` / `requestInterceptorsCatch` / `responseInterceptors` / `responseInterceptorsCatch`），对外暴露 `request` / `get` / `post` / `put` / `patch` / `delete` / `isCancel`。
- `adapters/` —— 六个 axios adapter：`id`（`nanoid(16)` 生成 `_requestId`）、`cancel`（`AbortController` 取消池）、`cache`（LRU，命中条件是 `method === 'get' && _cache`）、`throttle`（`_throttle` 毫秒内的同 URL GET 复用同一 promise）、`retry`（`_retryTimes`，业务码非成功或抛错都重试）、`merge`（`_mergeRequest`，50ms 防抖把多个同 URL GET 合成一次请求）。`composeAdapters(options)` 用 `reduceRight` 把它们叠在 axios 的 `fetch` adapter 之上，装配顺序是 id → cancel → cache → throttle → retry → merge。
- `types.ts` —— `AxiosConfig` / `AxiosTransformers`，以及 **axios 的模块增强**：`_carryToken` / `_timestamp` / `_cache` / `_cache_force_update` / `_retryTimes` / `_throttle` / `_mergeRequest` / `_cancelOnRouteChange` / `_autoEncryptRequestData` / `_autoDecryptResponseData` 等私有字段都挂在 `AxiosRequestConfig` 上。
- `constant.ts` + `utils.ts` —— 业务响应码（从 `@walnut/contract/response-code` 重导出）、`buildSortedURL`（缓存 key 的构造）、`generateNonce`。

**边界**：本包只提供**机制**，不提供**策略**。加解密、签名、refresh token / cap token 刷新、错误提示、全局验证弹窗全部由 app 侧拦截器注入（`apps/admin/src/utils/axios/interceptors/**`）——`Axios` 构造时只收 `originalConfig` + `transformers` 两个入参。它也不是业务 API 层，包内没有任何 API 函数。运行形态上几乎双运行时（ADR 0017 §5：唯一的浏览器 only 一行已抽象成 `typeof location !== 'undefined' ? location.pathname : '/'`），但 server 用 `@nestjs/axios`，且被 ESLint 明确禁止引用。

## 导出面

| 入口 | 指向 | 内容 |
|---|---|---|
| `.` | `src/index.ts` | 桶入口，按 ADR 0013 只做显式具名重导出 |
| `./*` | `src/*.ts` | 逐文件子路径；admin 走这里：`@walnut/http/instance`、`/types`、`/adapters/index`、`/adapters/cancel`、`/utils` |

桶入口的全部内容：

- `Axios`（class，`src/instance.ts`）
- `composeAdapters`（`src/adapters/index.ts`）
- 取消池三件套：`removeAllCancel` / `removeCurrentPageRequests` / `removeLatestRequest`
- 类型：`AxiosConfig`、`AxiosTransformers`、`BaseResponse`、`BaseListParams`、`BaseListResponse`、`BasePageParams`、`BaseSortParams`、`SortOrder`
- `WalnutAdminConstAppResponseCode`、`generateNonce`

**不在**桶入口的：各 adapter 工厂（`createCacheAdapter` / `createThrottleAdapter` / `retryAdapter` / `mergeAdapter` / `idAdapter` / `cancelAdapter`）、`buildSortedURL`、以及 `ComposeAdaptersOptions` 类型 —— 它们由 `composeAdapters` 内部装配，要单独用只能走子路径。

## 怎么用

```ts
// 1. 建实例：适配器链装在 originalConfig.adapter 上，拦截器通过 transformers 注入
import { Axios, composeAdapters } from '@walnut/http'

export const AppAxios = new Axios({
  originalConfig: {
    baseURL: '/api',
    timeout: 10_000,
    adapter: composeAdapters({ cacheTTLSeconds: 60 }),
    _cancelOnRouteChange: true, // 让 cancelAdapter 把请求登记进取消池
  },
  transformers: {
    requestInterceptors: async config => config,
  },
})
```

```ts
// 2. 发请求：私有字段直接写在 config 上，决定走哪些 adapter
const res = await AppAxios.get<{ code: number, data: string[] }>({
  url: '/user/list',
  params: { page: 1, size: 20 },
  _cache: true, // cacheAdapter：同 URL + 同 params 在 TTL 内直接复用
  _retryTimes: 2, // retryAdapter
})
```

```ts
// 3. 路由离开时清掉本页未完成的请求（取消池由 cancelAdapter 维护）
import type { Router } from 'vue-router'
import { removeCurrentPageRequests } from '@walnut/http/adapters/cancel'

export function createAfterEachGuard(router: Router) {
  router.afterEach((_to, from) => {
    if (!from.meta.cache)
      removeCurrentPageRequests(from.path)
  })
}
```

## 依赖与边界

- **运行期依赖**：`@walnut/contract`（`/response`、`/pagination`、`/response-code` 三个子路径）+ `axios`、`lodash-es`（仅 merge adapter 的 `debounce`）、`lru-cache`（cache / throttle 两个 adapter 各自的 LRU，容量 100）、`nanoid`（requestId）。
- **没有 peerDependencies**：`package.json` 的 `walnut.runtime` 写着 `dom` + `vue`，但 `src/` 里没有任何 `vue` 导入 —— 它连 Vue 类型都不需要。
- **谁依赖它**：`@walnut/admin`。跨端常量与类型一律直接消费 `@walnut/contract`，本包只做重导出（ADR 0004：无包装层）。
- **turbo 标签**：`shared` + `platform-web`；后端另有一道 ESLint 显式拦截 —— `@walnut/eslint-config/nest` 的 `no-restricted-imports` 把 `@walnut/http*` 列为禁止项（理由写在规则里：server 应该用 `@nestjs/axios` 或裸 axios）。

## 已知限制与延后工作

- **没有 `test` 脚本，也没有 `vitest.config.ts`**：ADR 0015 的 Consequences 原文就是「`@walnut/http` still needs its `vitest.config.ts` and `test` script (currently missing both)」，至今未补 —— 对照 `package.json` 的 `scripts` 段与包内文件列表。
- **拦截器策略全部在 app 侧**：URL 加解密（`interceptors/request/crypto.ts`、`response/crypto.ts`）、签名（`response/sign.ts`）、refresh / cap token（`response/refreshToken.ts`、`capJSToken.ts`）都还在 `apps/admin/src/utils/axios/interceptors/` —— 把它们抽成 `@walnut/security` 是待办 A9（目录尚未创建），ADR 0017 §5 只完成了 `location.pathname` 的抽象。
- **响应信封类型的导出错位**：`src/types.ts` 把 `BaseResponse` 标为 `@deprecated` 并建议改用 `@walnut/contract/response` 的 `ResponseBase`，但桶入口导出的仍是 `BaseResponse`，**没有**导出 `ResponseBase`（后者只在 `src/types.ts:5` 为重导出）。
- **axios 模块增强有两份**：`src/types.ts` 里那份已收进包，`apps/admin/src/utils/axios/types.d.ts` 里还有一份逐字重复的 `declare module 'axios'` —— 迁移没删干净。
- **merge adapter 的响应分发是占位逻辑**：`adapters/merge.ts` 自己的注释写着 `Assume API returns data in format { [paramValue]: responseData }`、`should be adjusted according to actual API response format`；且 `_mergeRequest` 全仓只在 `apps/admin/src/views/demo/Extra/Axios.vue` 命中，业务 API 零使用。
- **旧名的残留面**：`@walnut/axios` 在 `packages/tooling/scripts/src/ci/check-doc-refs.ts` 的 `ALLOWED_MISSING_PACKAGES` 豁免表内，所以门禁不会拦它。2026-09-23 之前这掩盖了一处**真漂移** —— 活文档 `apps/docs/src/zh-CN/content/introduction.md` 的包清单仍把它当现存包（已改正为 `@walnut/http`）。现在提它的只剩**改名决策的历史记录**（ADR 0001/0005/0010/0013/0017）与冻结语料（`industry-research/07`），那两类引用是合理的。

## 相关

- [ADR 0004：直接消费 contract、无包装层](../../../apps/docs/src/zh-CN/content/adr/0004-direct-contract-consumption.md)
- [ADR 0005：前端 only 走 JIT](../../../apps/docs/src/zh-CN/content/adr/0005-jit-vs-build.md)
- [ADR 0013：桶导出策略](../../../apps/docs/src/zh-CN/content/adr/0013-barrel-exports-policy.md)
- [ADR 0015：测试策略](../../../apps/docs/src/zh-CN/content/adr/0015-testing-strategy.md)
- [ADR 0017：Package 重组（§5 是本包，含改名决策）](../../../apps/docs/src/zh-CN/content/adr/0017-package-reorganization.md)
- [Monorepo 架构总览](../../../apps/docs/src/zh-CN/content/monorepo/index.md) ｜ [架构待办（A9）](../../../apps/docs/src/zh-CN/content/monorepo/architecture-todo.md)
