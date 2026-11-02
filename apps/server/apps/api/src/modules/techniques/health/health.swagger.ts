import type { SchemaObject } from '@nestjs/swagger'
import { applyDecorators } from '@nestjs/common'
import { ApiOkResponse } from '@nestjs/swagger'

import { WalnutAdminSwaggerResponseSuccessSchemeData } from '@walnut-server/decorators/swagger'

/**
 * health 五端点的 200 声明（F-09 / 裁决 Q5-a：改文档，不改行为）。
 *
 * ## 为什么要覆盖 terminus 的默认声明
 *
 * `@HealthCheck()` 会在端点上挂两件事：`Cache-Control` 头（noCache）**和** Swagger 默认声明
 * —— 后者声明 `200 {status, info, details, error}` 与 `503`。本仓这两条都与实现不符：
 *
 * 1. **503 不可达**：控制器直接调 indicator 的 `pingCheck` / `checkHeap` / `checkStorage`，
 *    不经 `HealthCheckService`，失败时抛 `HealthCheckError`，被全局异常过滤器兜成
 *    **HTTP 200 + body.code = 50000**。声明 503 会让编排方按文档做 503 判活而误判
 *    （真正的存活/就绪探针是 raw 路由 `/health/live`、`/health/ready`，见 app/probes.composition.ts）。
 * 2. **形状不符**：响应是项目统一壳 `{ code, msg, data }`，其中 `data` 是 terminus 的
 *    HealthIndicatorResult —— `{ <indicator>: { status: 'up' | 'down', ... } }`，
 *    没有 `{status, info, details}` 那层外壳。
 *
 * 所以每个端点显式重写 200（形状写实、去掉 503）：`@HealthCheck({ swaggerDocumentation: false })`
 * 关掉 terminus 的默认声明（保留它的 Cache-Control 头），由本文件的装饰器接管。
 */

/** 单个 indicator 的结果：terminus `HealthIndicatorSession.compose()` 的产物（status 之后可能有附加字段） */
const HEALTH_INDICATOR_RESULT: SchemaObject = {
  type: 'object',
  description:
    'terminus indicator result; besides `status` an indicator may add extra fields (e.g. `message`, or HTTP `statusCode`/`statusText` for the network probe)',
  required: ['status'],
  properties: {
    status: {
      type: 'string',
      enum: ['up', 'down'],
      description: 'condition result of this indicator',
    },
    message: {
      type: 'string',
      description: 'failure reason, only present on some indicators',
    },
  },
}

/**
 * health 端点的 200 声明：项目统一壳 + `data: { <indicator>: { status, ... } }`。
 *
 * @param indicator terminus indicator key（就是响应 `data` 里那个唯一的键，如 `baidu` / `postgres`）
 * @param description 该端点的 200 说明
 */
export function AppTechHealthCheckOkResponse(indicator: string, description: string) {
  return applyDecorators(
    ApiOkResponse({
      description,
      schema: WalnutAdminSwaggerResponseSuccessSchemeData({
        type: 'object',
        required: [indicator],
        properties: {
          [indicator]: HEALTH_INDICATOR_RESULT,
        },
      }),
    }),
  )
}
