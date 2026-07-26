import { applyDecorators } from '@nestjs/common'

import { Allow, IsDefined, IsNotEmptyObject, IsObject, ValidateNested } from 'class-validator'
import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

function defaultOptions(): IWADVObjOpt {
  return {
    required: true,
    any: false,
  }
}

export function WalnutAdminDecoratorValidatorObject(
  options?: IWADVObjOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators: PropertyDecorator[] = []

  const { required, any } = Object.assign(defaultOptions(), options)

  if (any === true) {
    decorators.push(Allow())
  }
  else {
    if (required === false) {
      decorators.push(Allow())
    }
    else {
      decorators.push(
        IsDefined({ each: isArray }),
        IsObject({ each: isArray }),
        ValidateNested({ each: isArray }),
        IsNotEmptyObject({ nullable: true }),
      )
    }
  }

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  return applyDecorators(...decorators)
}
