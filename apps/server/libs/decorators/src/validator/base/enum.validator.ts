import { applyDecorators } from '@nestjs/common'
import { IsEnum, IsNotEmpty, ValidateIf } from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

const defaultOptions = (): IWADVEnumOpt => ({})

export function WalnutAdminDecoratorValidatorEnum<TEnum>(
  getEnum: () => TEnum,
  options?: IWADVEnumOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  const enumValue = getEnum()
  const { allowFalseValue } = Object.assign(defaultOptions(), options)

  // 契约允许 `false` 时（SortOrder 的"该列不排序"，contract/pagination.ts:8），
  // `false` 跳过本字段全部校验；其余值仍走枚举 + 非空。
  const gate: PropertyDecorator[] = allowFalseValue === true
    ? [ValidateIf((_object, value) => value !== false)]
    : []

  let decorators = [
    ...gate,
    IsEnum(enumValue as object, { each: isArray }),
    IsNotEmpty({ each: isArray }),
  ]

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  return applyDecorators(...decorators)
}
