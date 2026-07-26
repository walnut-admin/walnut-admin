import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'

import { WalnutAdminDecoratorTransformerDate as WADTD } from '../transformer/base/date.transformer'
import { WalnutAdminDecoratorValidatorDate as WADVD } from '../validator/base/date.validator'

export function WalnutAdminDecoratorFieldDate(
  options: IWADDateOpt,
): PropertyDecorator {
  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVD(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTD(options?.transformOptions, options?.isArray),
  ]

  decorators.unshift(
    ApiProperty({
      type: Date,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      ...options?.swaggerOptions,
    }),
  )

  return applyDecorators(...decorators)
}
