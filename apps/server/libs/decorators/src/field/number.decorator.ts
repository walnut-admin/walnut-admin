import { applyDecorators } from '@nestjs/common'
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { Expose } from 'class-transformer'

import { WalnutAdminDecoratorTransformerNumber as WADTN } from '../transformer/base/number.transformer'
import { WalnutAdminDecoratorValidatorNumber as WADVN } from '../validator/base/number.validator'

export function WalnutAdminDecoratorFieldNumber(
  options: IWADNumOpt,
): PropertyDecorator {
  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVN(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTN(options?.transformOptions, options?.isArray, options?.default),
  ]

  // 可选性只有一个真源：`validateOptions.optional`（运行时「缺省即跳过校验」）⇒ schema 也必须说
  // 「可以不传」，否则文档说必填、实现说可缺省。`ApiPropertyOptional` 就是
  // `ApiProperty({ ...options, required: false })`（批次 9 · C5 收掉了那处不诚实）。
  //
  // 为什么在**外面**选装饰器、而不是往字面量里塞 `required`：`swaggerOptions` 的类型是
  // `ApiPropertyOptions`（联合类型），与它一起 spread 时 `required` 的联合会被摊平，TS 随即按
  // `type: 'object'` 那一支报错（`Type 'NumberConstructor' is not assignable to '"object"'`）。
  const apiPropertyDecorator = options?.validateOptions?.optional === true
    ? ApiPropertyOptional
    : ApiProperty

  decorators.unshift(
    apiPropertyDecorator({
      type: Number,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      maximum: options?.swaggerOptions?.maxLength,
      minimum: options?.swaggerOptions?.minLength,
      ...options?.swaggerOptions,
    }),
  )

  return applyDecorators(...decorators)
}
