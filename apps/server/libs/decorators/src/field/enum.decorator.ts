import type { EnumAllowedTypes } from '@nestjs/swagger/dist/interfaces/schema-object-metadata.interface'
import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'

import { Expose } from 'class-transformer'
import { WalnutAdminDecoratorTransformerEnum as WADTE } from '../transformer/base/enum.transformer'
import { WalnutAdminDecoratorValidatorEnum as WADVE } from '../validator/base/enum.validator'

export function WalnutAdminDecoratorFieldEnum<TEnum extends EnumAllowedTypes>(
  getEnum: () => TEnum,
  options: IWADEnumOpt,
): PropertyDecorator {
  const enumValue = getEnum()

  const decorators = [
    // used for list request payload sort field key
    Expose(),
    WADVE(
      getEnum,
      options?.validateOptions,
      options?.isArray,
      options?.arrayOptions,
    ),
    WADTE(options?.transformOptions, options?.isArray),
  ]

  decorators.unshift(
    ApiProperty({
      enum: enumValue,
      enumName: getEnum.name,
      default: options?.default,
      isArray: options?.isArray,
      maxItems: options?.arrayOptions?.maxSize,
      minItems: options?.arrayOptions?.minSize,
      ...options?.swaggerOptions,
    }),
  )

  return applyDecorators(...decorators)
}
