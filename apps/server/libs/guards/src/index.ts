/**
 * guard / decorator / interceptor 装配层 barrel（libs 解耦批 8）。
 *
 * 三个目录按「请求管线默认件」的同一内聚标准收在这里，而不是再拆三个小 lib：
 * - `guards/`：16 个 guard（env / functional / throttler / visitor / roles / permission /
 *   auth / device / lock / mfa / capability / risk / sensitive / security / ip / sign）；
 * - `decorators/`：cookie / user / crypto / response / cache / dataScope / functional /
 *   hasPermission / hasRole / log.auth；
 * - `interceptors/`：ALS / success / loose / encrypt / decrypt。
 *
 * 不算本 lib 的：
 * - `log.operate.decorator` 留 app（批 4 既定 shim，另有 4+1 消费者）；
 * - passport mixin guard（Google / OAuth / Opaque / OTP / Refresh）与 11 个 APP_GUARD /
 *   2 个 APP_INTERCEPTOR 的**顺序**留在 app 组合根 —— 顺序是安全语义。
 *
 * 依赖方向：本 lib → auth / security / identity / system / cache / ip 等 `@walnut-server/*`。
 * 反向不成立：lib 内零 `@/`。
 */
export * from './decorators/cache.decorator'
export * from './decorators/cookie.decorator'
export * from './decorators/crypto.decorator'
export * from './decorators/dataScope.decorator'
export * from './decorators/functional.decorator'
export * from './decorators/hasPermission.decorator'
export * from './decorators/hasRole.decorator'
export * from './decorators/log.auth.decorator'
export * from './decorators/response.decorator'
export * from './decorators/user.decorator'

export * from './guards/auth.guard'
// cap.guard.ts 的**类**走子路径 '@walnut-server/guards/guards/cap.guard'（只有组合根引它），
// barrel 只导出装饰器面 —— 否则每个只为拿 WalnutAdminGuardCapFree 的 controller 都会经
// cap.guard.ts 把 @walnut-server/security/cap/cap.service 的 `new Cap()` 拖进自己的求值闭包。
export * from './guards/cap.decorator'
export * from './guards/device.guard'
export * from './guards/env.guard'
export * from './guards/functional.guard'
export * from './guards/ip.guard'
export * from './guards/lock.guard'
export * from './guards/mfa.guard'
export * from './guards/permission.guard'
export * from './guards/risk.guard'
export * from './guards/roles.guard'
export * from './guards/security.guard'
export * from './guards/sensitive.guard'
export * from './guards/sign.guard'
export * from './guards/throttler.guard'
export * from './guards/visitor.guard'

export * from './interceptors/request/als.interceptor'
export * from './interceptors/request/decrypt.interceptor'
export * from './interceptors/response/encrypt.interceptor'
export * from './interceptors/response/loose.interceptor'
export * from './interceptors/response/success.interceptor'
