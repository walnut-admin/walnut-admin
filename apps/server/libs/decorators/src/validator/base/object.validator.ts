import { applyDecorators } from '@nestjs/common'

import { Allow, IsDefined, IsNotEmptyObject, IsObject, IsOptional, ValidateNested } from 'class-validator'
import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

function defaultOptions(): IWADVObjOpt {
  return {
    required: true,
    any: false,
    nestedWhenPresent: false,
  }
}

export function WalnutAdminDecoratorValidatorObject(
  options?: IWADVObjOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators: PropertyDecorator[] = []

  const { required, any, nestedWhenPresent } = Object.assign(defaultOptions(), options)

  if (any === true) {
    decorators.push(Allow())
  }
  else {
    if (required === false) {
      decorators.push(Allow())

      // 批次 1 · P0（list 的 query / sort / page 三槽位）：可缺省，但**给了就下钻**。
      // 缺省不开（历史语义只有 Allow()，内层约束全部只进 swagger）；
      // 注意不要顺手加 IsNotEmptyObject —— query:{} / sort:[] 是现存合法调用。
      if (nestedWhenPresent === true) {
        decorators.push(
          IsOptional(),
          IsObject({ each: isArray }),
          ValidateNested({ each: isArray }),
        )
      }
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
