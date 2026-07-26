import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
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

  decorators.unshift(
    ApiProperty({
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
