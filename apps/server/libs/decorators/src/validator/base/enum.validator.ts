import { applyDecorators } from '@nestjs/common'
import { IsEnum, IsNotEmpty } from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

const defaultOptions = (): IWADVEnumOpt => ({})

export function WalnutAdminDecoratorValidatorEnum<TEnum>(
  getEnum: () => TEnum,
  options?: IWADVEnumOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  const enumValue = getEnum()

  let decorators = [
    IsEnum(enumValue as object, { each: isArray }),
    IsNotEmpty({ each: isArray }),
  ]

  const {} = Object.assign(defaultOptions(), options)

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  return applyDecorators(...decorators)
}
