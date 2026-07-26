import { applyDecorators } from '@nestjs/common'
import {
  IsBooleanString,
  IsEmail,
  IsIn,
  IsIP,
  IsLowercase,
  IsNotEmpty,
  isNumber,
  IsNumberString,
  IsPhoneNumber,
  IsString,
  IsUppercase,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator'

import { WalnutAdminDecoratorValidatorArray } from '../common/array.validator'
import { IsNullable } from '../common/nullable.validator'

function defaultOptions(): IWADVStrOpt {
  return {
    booleanString: false,
    numberString: false,
    upper: false,
    lower: false,
    url: false,
    phoneNumber: false,
    email: false,
    ip: false,
    nullable: false,
  }
}

export function WalnutAdminDecoratorValidatorString(
  options?: IWADVStrOpt,
  isArray?: boolean,
  arrayOptions?: IWalnutAdminDecoratorArrayOptions,
): PropertyDecorator {
  let decorators = [IsString({ each: isArray }), IsNotEmpty({ each: isArray })]

  const {
    booleanString,
    numberString,
    upper,
    lower,
    minLen,
    maxLen,
    url,
    phoneNumber,
    email,
    ip,
    onlyIn,
    nullable,
  } = Object.assign(
    defaultOptions(),
    options,
  )

  if (isArray) {
    decorators = WalnutAdminDecoratorValidatorArray(decorators, arrayOptions)
  }

  if (booleanString) {
    decorators.push(
      IsBooleanString({
        each: isArray,
      }),
    )
  }

  if (numberString) {
    decorators.push(IsNumberString({}, { each: isArray }))
  }

  if (upper) {
    decorators.push(
      IsUppercase({
        each: isArray,
      }),
    )
  }

  if (lower) {
    decorators.push(
      IsLowercase({
        each: isArray,
      }),
    )
  }

  if (url) {
    decorators.push(IsUrl({}, { each: isArray }))
  }

  if (phoneNumber) {
    decorators.push(
      // TODO not i18n
      // TODO need call code before
      IsPhoneNumber('CN', {
        each: isArray,
      }),
    )
  }

  if (ip) {
    decorators.push(IsIP('4', { each: isArray }))
  }

  if (email) {
    decorators.push(IsEmail({}, { each: isArray }))
  }

  if (onlyIn && onlyIn.length !== 0) {
    decorators.push(
      IsIn(onlyIn, {
        each: isArray,
      }),
    )
  }

  if (isNumber(minLen)) {
    decorators.push(
      MinLength(minLen, {
        each: isArray,
      }),
    )
  }

  if (isNumber(maxLen)) {
    decorators.push(
      MaxLength(maxLen, {
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
