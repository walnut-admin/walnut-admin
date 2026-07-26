import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'

import { WalnutAdminDecoratorTransformerBoolean as WADTB } from '../transformer/base/boolean.transformer'
import { WalnutAdminDecoratorValidatorBoolean as WADVB } from '../validator/base/boolean.validator'

export function WalnutAdminDecoratorFieldBoolean(
  options: IWADBoolOpt,
): PropertyDecorator {
  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVB(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTB(options?.transformOptions, options?.isArray),
  ]

  decorators.unshift(
    ApiProperty({
      type: Boolean,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      ...options?.swaggerOptions,
    }),
  )

  return applyDecorators(...decorators)
}
