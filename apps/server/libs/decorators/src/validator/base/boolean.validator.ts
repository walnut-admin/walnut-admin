import { applyDecorators } from '@nestjs/common'
import { IsBoolean, IsNotEmpty } from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

const defaultOptions = (): IWADVBoolOpt => ({})

export function WalnutAdminDecoratorValidatorBoolean(
  options?: IWADVBoolOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators = [
    IsBoolean({ each: isArray }),
    IsNotEmpty({ each: isArray }),
  ]

  const {} = Object.assign(defaultOptions(), options)

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  return applyDecorators(...decorators)
}
