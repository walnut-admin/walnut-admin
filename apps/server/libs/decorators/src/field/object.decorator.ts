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
  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVO(options?.validateOptions, options?.isArray, options?.arrayOptions),
    WADTO(obj, options?.transformOptions, options?.isArray, options?.default),
  ]

  decorators.unshift(
    ApiProperty({
      type: () => obj,
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
