import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'
import { Allow } from 'class-validator'

/**
 * 任意形态字段（TS 侧声明为 `unknown`）—— **只 `Expose()` + `Allow()`，不做任何校验**。
 *
 * ## 为什么需要它
 *
 * list 的 `filters[].value` 形态由 `op` 决定（`eq` 标量 / `like` 字符串 /
 * `in` 数组 / `range` 长度 2 的数组 / `isNull` 不带值）。class-validator 无法在
 * 字段级表达"按另一个字段的取值分叉"，硬塞 `IsString` 会把 `in` 的数组直接 400。
 * 语义裁决的权威在服务端的列类型裁决点（`pg-column-op` 的 `resolvePgFilterCondition`），
 * 那里解释不了就 40099 —— 所以这里必须放行。
 *
 * ## swagger
 *
 * 显式给 `oneOf` 五形态，**不让插件按 design:type 猜成 `object`**：猜成 object 会让
 * 生成物（openapi-typescript）把 `value` 收窄成 `Record<string, unknown>`，`value: 'abc'`
 * 在消费侧直接类型错误。
 */
const ANY_VALUE_SWAGGER_ONEOF = [
  { type: 'string' as const },
  { type: 'number' as const },
  { type: 'boolean' as const },
  { type: 'array' as const, items: {} },
  { type: 'object' as const, additionalProperties: true },
]

export function WalnutAdminDecoratorFieldAny(
  options?: IWADAnyOpt,
): PropertyDecorator {
  return applyDecorators(
    ApiProperty({
      ...options?.swaggerOptions,
      oneOf: options?.swaggerOptions?.oneOf ?? ANY_VALUE_SWAGGER_ONEOF,
      nullable: true,
    }),
    Expose(),
    Allow(),
  )
}
