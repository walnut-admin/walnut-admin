import type { ApiPropertyOptions } from '@nestjs/swagger'
import { applyDecorators } from '@nestjs/common'
import { ApiProperty } from '@nestjs/swagger'

import { Expose } from 'class-transformer'
import { WalnutAdminDecoratorTransformerEnum as WADTE } from '../transformer/base/enum.transformer'
import { WalnutAdminDecoratorValidatorEnum as WADVE } from '../validator/base/enum.validator'

/**
 * @nestjs/swagger 12 起 exports map 只开放 `.` 与 `./plugin`，原先的
 * `@nestjs/swagger/dist/interfaces/schema-object-metadata.interface` 深导入被拦。
 * 该类型未从包根导出，改由公开的 `ApiPropertyOptions['enum']` 反推（同形）。
 */
type EnumAllowedTypes = NonNullable<ApiPropertyOptions['enum']>

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
