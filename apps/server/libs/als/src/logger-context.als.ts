import { AsyncLocalStorage } from 'node:async_hooks'

/**
 * logger 上下文的 store 形状（请求级追踪字段）。
 *
 * 与 `request.service.ts` 的 `RequestContext` 是两套互不相干的字段集合：同一个请求上
 * `LoggerMiddleware` 先进入 logger 上下文，`ALSRequestInterceptor` 之后才进入请求上下文。
 */
export interface ILoggerContextStore {
  /** 请求唯一 ID（trace 用；来源是 `IdMiddleware` 种的 `req.id`） */
  requestId: string
}

/**
 * logger 上下文的 `AsyncLocalStorage` 实例。
 *
 * **为什么与 `ALSRequestService` 是两个实例、而不是一个实例两个 key**（D13②：`libs/context`
 * 并入 `libs/als`，合的是模块与安装面，不是 store）：两者都用 `run()` 做**整段 store 替换**。
 * 共用实例时，后跑的 `ALSRequestInterceptor.run()` 会把中间件种下的 store 顶掉 —— handler
 * 里 winston formatter 就读不到 `requestId`，日志链路静默断掉。两个实例下 `run()` 的嵌套语义
 * 与合并前逐字一致（中间件 → 拦截器 → handler 全程两份 store 同时可见）。
 *
 * 直接读本实例的只有 **DI 容器外**的场景：winston 的文件 formatter
 * （`apps/api/src/modules/techniques/logger/index.ts`）。DI 场景用 `LoggerContextService`。
 *
 * // LINK apps/docs/src/zh-CN/content/monorepo/architecture-todo.md —— D13②（context 的 ALS 并入 als）
 */
export const loggerContextALS = new AsyncLocalStorage<ILoggerContextStore>()
