import type { ValidationArguments, ValidationOptions } from 'class-validator'
import { applyDecorators } from '@nestjs/common'
import { IsNotEmpty, registerDecorator, Validate } from 'class-validator'

import { Types } from 'mongoose'
import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'
import { IsNullable } from '../common/nullable.validator'

function IsMongoIdCustom(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'IsMongoIdCustom',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: string, _args: ValidationArguments) {
          return Types.ObjectId.isValid(value)
        },
      },
    })
  }
}

export function defaultOptions(): IWalnutAdminDecoratorValidatorMongoIdOptions {
  return {
    nullable: false,
  }
}

export function WalnutAdminDecoratorValidatorMongoId(
  options?: IWADVMIdOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators: PropertyDecorator[] = [
    IsMongoIdCustom({ each: isArray }) as PropertyDecorator,
    IsNotEmpty({ each: isArray }),
  ]

  const { validate, nullable } = Object.assign(defaultOptions(), options)

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  if (validate) {
    decorators.push(
      Validate(validate, {
        each: isArray,
      }),
    )
  }

  if (nullable) {
    decorators.push(
      IsNullable({
        each: isArray,
      }),
    )
  }

  return applyDecorators(...decorators)
}
