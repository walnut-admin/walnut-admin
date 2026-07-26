import { applyDecorators } from '@nestjs/common'
import { IsDate, IsDateString, IsNotEmpty } from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

function defaultOptions(): IWADVDateOpt {
  return {
    stringDate: true,
  }
}

export function WalnutAdminDecoratorValidatorDate(
  options?: IWADVDateOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators = [IsNotEmpty({ each: isArray })]

  const { stringDate } = Object.assign(defaultOptions(), options)

  decorators.push(
    stringDate
      ? IsDateString({}, { each: isArray })
      : IsDate({ each: isArray }),
  )

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  return applyDecorators(...decorators)
}
