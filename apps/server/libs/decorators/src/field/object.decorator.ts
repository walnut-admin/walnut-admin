import type { ClassConstructor } from 'class-transformer'
import { applyDecorators } from '@nestjs/common'
import { ApiExtraModels, ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'

import { WalnutAdminDecoratorTransformerObject as WADTO } from '../transformer/base/object.transformer'
import { WalnutAdminDecoratorValidatorObject as WADVO } from '../validator/base/object.validator'

export function WalnutAdminDecoratorFieldObject(
  obj: ClassConstructor<any>,
  options: IWADObjOpt,
): PropertyDecorator {
  // 松散对象（obj === Object，即 Recordable 类字段）：swagger 若只拿到无 properties 的
  // { type: object }，openapi-typescript 会生成 `Record<string, never>` 废类型（任何取值
  // 都不可用）。补 additionalProperties: true 让生成形态成为可用的 Record<string, unknown>；
  // 显式传了 properties / additionalProperties 的调用方不受影响（见 swaggerOptions 展开）。
  const looseObjectDefaults = obj === Object ? { additionalProperties: true } : {}

  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVO(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTO(obj, options?.transformOptions, options?.isArray, options?.default),
  ]

  decorators.unshift(
    ApiProperty({
      type: () => obj,
      ...looseObjectDefaults,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      ...options?.swaggerOptions,
    }),
  )

  decorators.unshift(ApiExtraModels(obj))

  return applyDecorators(...decorators)
}
