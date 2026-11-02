import type { INestApplication, Type } from '@nestjs/common'
import type { OpenAPIObject } from '@nestjs/swagger'

import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core'
import { ApiBearerAuth, ApiSecurity, SwaggerModule } from '@nestjs/swagger'
import { WalnutAdminConstDecoratorJwtFreeKey, WalnutAdminConstDecoratorJwtOptionalKey } from '@walnut-server/auth'

import { buildSwaggerDocumentOptions } from './swagger.options'

/**
 * OpenAPI 文档的**唯一组装点**：bearer 批量注入 + createDocument。
 *
 * main.ts（运行时挂 /api 的 Scalar 文档）与 apps/cli/src/export-openapi.ts（离线导出
 * openapi.json）都只调这里的 `createSwaggerDocument`，保证在线文档与 check-in 的导出物同源。
 *
 * ## 为什么 bearer 注入落在这里，而不是 ApiWalnutOkResponse / CRUD 工厂（裁决 Q4 的 a 项）
 *
 * 工厂里做不出这个判断 —— **类级元数据在方法装饰器执行时还不存在**。装饰器求值顺序是
 * 「成员装饰器先跑、类装饰器后跑」，而 `@WalnutAdminGuardJwtFree()` 绝大多数挂在**类级**
 * （refresh / otp / rsa / sign / cap / setting 的 public / lang 的 public ...）。
 * 探针实测（方法装饰器里读 `WalnutAdminConstDecoratorJwtFreeKey`）：原型与
 * `target.constructor` 上读到的都是 undefined。也就是说按 Q4-a 字面在工厂里判断 Free，
 * 会把**所有类级 JwtFree 的匿名端点误判成受保护**。
 *
 * 于是判断推迟到**容器装配完成之后**（此时类级 + 方法级元数据都已就位，与 JwtAccessGuard
 * 运行时用的是同一个 `Reflector.getAllAndOverride`），一次性给所有「非匿名」handler 打上
 * `security: [{ bearer: [] }]`。落点只有这一处、端点侧零改动，全站 operation 一致生效
 * （含不走 ApiWalnutOkResponse / CRUD 工厂的端点，如 health、cap、monitor）。
 *
 * ## 匿名端点为什么是「没有 security 字段」
 *
 * 文档根**不声明** `security`，所以「未声明」在 OpenAPI 语义里就是「不要求认证」
 * （JwtFree / 全 Free）。这样匿名端点保持裸的 operation，受保护端点逐个声明 bearer，
 * 不需要给匿名端点塞 `security: []` 这类占位。
 *
 * ## 三档判据（与 JwtAccessGuard 的运行时行为一一对应）
 *
 * | 运行时 | 元数据 | 文档声明 |
 * |--------|--------|----------|
 * | 不做 JWT 认证 | `JwtFree` | 不声明 security（= 匿名） |
 * | 认证但不强制（有就给 user，没有也放行） | `JwtOptional` | `[{ bearer: [] }, {}]` |
 * | 必须认证 | 都没有 | `[{ bearer: [] }]` |
 *
 * Optional 那一档（批次6-B 补）：OpenAPI 的 `security` 数组是**或**关系，追加一个空对象
 * `{}` 即「不带任何凭据也可以」—— 恰好表达「可带 bearer，也可匿名」。此前
 * `WalnutAdminConstDecoratorJwtOptionalKey` 是 `@walnut-server/auth` 的模块私有 Symbol，
 * 读不到，于是 user_preference 这类端点在文档里被写成了纯受保护（读者以为必须登录）。
 *
 * ## 已知边界
 *
 * - 端点若手写 `@ApiBearerAuth()`，本函数会再追加一条（语义等价、但数组里重复）。
 *   约定：受保护端点不要手写，统一走本函数。
 */

/** 幂等标记：同一 handler 只注入一次（createDocument 可能被反复调用，如 Scalar 每次请求重建文档） */
const WALNUT_ADMIN_SWAGGER_BEARER_INJECTED = Symbol('WALNUT_ADMIN_SWAGGER_BEARER_INJECTED')

/**
 * 给所有「非匿名」handler 注入 `security: [{ bearer: [] }]`（`JwtOptional` 的 handler
 * 追加空要求变成 `[{ bearer: [] }, {}]`），返回本次注入的 operation 数。
 *
 * 判据与 JwtAccessGuard 完全一致：`Reflector.getAllAndOverride(JwtFree / JwtOptional,
 * [handler, class])` —— 同一个 key、同一种「方法级覆盖类级」语义，文档与运行时不会漂移。
 * 必须在 `app.init()` 之后调用（控制器实例与元数据此时才齐）。
 */
export function applySwaggerBearerAuth(app: INestApplication): number {
  const reflector = app.get(Reflector)
  const discoveryService = app.get(DiscoveryService)
  const metadataScanner = app.get(MetadataScanner)

  let injected = 0

  for (const wrapper of discoveryService.getControllers()) {
    const metatype = wrapper.metatype as Type | null | undefined
    if (typeof metatype !== 'function' || metatype.prototype === undefined)
      continue

    const prototype = metatype.prototype as Record<string, unknown>

    for (const methodKey of metadataScanner.getAllMethodNames(prototype)) {
      const handler = prototype[methodKey]
      if (typeof handler !== 'function')
        continue

      const isAnonymous = reflector.getAllAndOverride<boolean>(
        WalnutAdminConstDecoratorJwtFreeKey,
        [handler as (...args: unknown[]) => unknown, metatype],
      ) === true

      if (isAnonymous)
        continue

      const isOptional = reflector.getAllAndOverride<boolean>(
        WalnutAdminConstDecoratorJwtOptionalKey,
        [handler as (...args: unknown[]) => unknown, metatype],
      ) === true

      if (Reflect.getMetadata(WALNUT_ADMIN_SWAGGER_BEARER_INJECTED, handler) === true)
        continue

      const descriptor = Object.getOwnPropertyDescriptor(prototype, methodKey)
      // 类方法恒为 data property（descriptor.value 即 handler）；拿不到描述符时跳过而不是
      // 直接调 ApiBearerAuth() —— 它会退化成写到 **原型** 上（openapi 读的是 handler 函数本体）。
      if (!descriptor || typeof descriptor.value !== 'function')
        continue

      ApiBearerAuth()(prototype, methodKey, descriptor)

      // JwtOptional：追加空要求 {} = 「不带凭据也可以」。ApiSecurity 的 metadata 是
      // concat 语义（extendMetadata），所以这一步得到 [{ bearer: [] }, {}] 而不是覆盖。
      if (isOptional)
        ApiSecurity({})(prototype, methodKey, descriptor)

      Reflect.defineMetadata(WALNUT_ADMIN_SWAGGER_BEARER_INJECTED, true, handler)

      injected += 1
    }
  }

  return injected
}

/** 组装 OpenAPI 文档：先注入 bearer 声明，再 createDocument（main.ts 与离线导出共用） */
export function createSwaggerDocument(app: INestApplication): OpenAPIObject {
  applySwaggerBearerAuth(app)

  return SwaggerModule.createDocument(app, buildSwaggerDocumentOptions())
}
