import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'
import { Expose } from 'class-transformer'

import { WalnutAdminDecoratorTransformerMongoId as WADTM } from '../transformer/base/mongoId.transformer'
import { WalnutAdminDecoratorValidatorMongoId as WADVM } from '../validator/base/mongoId.validator'

export function WalnutAdminDecoratorFieldMongoId(
  options: IWADMIdOpt,
): PropertyDecorator {
  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVM(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTM(options?.transformOptions, options?.isArray),
  ]

  decorators.unshift(
    ApiProperty({
      type: String,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      ...options?.swaggerOptions,
    }),
  )

  return applyDecorators(...decorators)
}
