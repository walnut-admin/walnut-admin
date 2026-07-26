import type {
  ValidationArguments,
  ValidationOptions,
} from 'class-validator'
import { applyDecorators } from '@nestjs/common'
import {
  IsIn,
  IsInt,
  IsNegative,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  Max,
  Min,
  registerDecorator,
} from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'

function defaultOptions(): IWADVNumOpt {
  return {
    positive: false,
    negative: false,
    max: Number.MAX_SAFE_INTEGER,
    min: Number.MIN_SAFE_INTEGER,
    int: false,
  }
}

export function WalnutAdminDecoratorValidatorNumber(
  options?: IWADVNumOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  const { positive, negative, max, min, int, onlyIn, precision }
    = Object.assign(defaultOptions(), options)

  let decorators = [
    IsNumber({}, { each: isArray }),
    IsNotEmpty({ each: isArray }),
  ]

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  if (positive) {
    decorators.push(
      IsPositive({
        each: isArray,
      }),
    )
  }

  if (negative) {
    decorators.push(
      IsNegative({
        each: isArray,
      }),
    )
  }

  if (typeof max === 'number') {
    decorators.push(Max(max, { each: isArray }))
  }

  if (typeof min === 'number') {
    decorators.push(Min(min, { each: isArray }))
  }

  if (int) {
    decorators.push(IsInt({ each: isArray }))
  }

  if (typeof precision === 'number') {
    decorators.push(IsPrecisionRight(precision, { each: isArray }) as PropertyDecorator)
  }

  if (Array.isArray(onlyIn) && onlyIn.length) {
    decorators.push(IsIn(onlyIn, { each: isArray }))
  }

  return applyDecorators(...decorators)
}

export function IsPrecisionRight(
  precision: number,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: IsPrecisionRight.name,
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: any, _args: ValidationArguments) {
          try {
            const decimal = String(String(value).split('.')[1])
            return decimal.length === precision
          }
          catch {
            return false
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `Invalid precision of ${args.property}`
        },
      },
    })
  }
}
