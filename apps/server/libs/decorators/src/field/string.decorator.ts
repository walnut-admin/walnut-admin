import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'

import { WalnutAdminDecoratorTransformerString as WADTS } from '../transformer/base/string.transformer'
import { WalnutAdminDecoratorValidatorString as WADVS } from '../validator/base/string.validator'

export function WalnutAdminDecoratorFieldString(
  options: IWADStrOpt,
): PropertyDecorator {
  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVS(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTS(options?.transformOptions, options?.isArray),
  ]

  decorators.unshift(
    ApiProperty({
      type: String,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      maxLength: options?.swaggerOptions?.maxLength,
      minLength: options?.swaggerOptions?.minLength,
      ...options?.swaggerOptions,
    }),
  )

  return applyDecorators(...decorators)
}
