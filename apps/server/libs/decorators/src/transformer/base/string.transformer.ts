import type { TransformOptions } from 'class-transformer'
import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'

import { isNil } from 'lodash'
import {
  WalnutAdminDecoratorTransformStringEmailMask,
  WalnutAdminDecoratorTransformStringPhoneNumberMask,
} from '../common/sensitive.transformer'

function defaultReqOpt(): IWADTStrReqOpt {
  return {
    trim: false,
    lower: false,
    upper: false,
    booleanString: true,
  }
}

function defaultResOpt(): IWADTStrResOpt {
  return {
    trim: false,
    lower: false,
    upper: false,
    booleanString: true,
    phoneNumberMask: false,
    emailMask: false,
  }
}

export function WalnutAdminDecoratorTransformerString(
  options?: IWADTStrOpt,
  isArray?: boolean,
) {
  const decorators: PropertyDecorator[] = []

  const reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  if (reqOptions.trim || resOptions.trim) {
    decorators.push(
      WalnutAdminDecoratorTransformStringToTrim(isArray, {
        toClassOnly: reqOptions.trim,
        toPlainOnly: resOptions.trim,
      }),
    )
  }

  if (reqOptions.lower || resOptions.lower) {
    decorators.push(
      WalnutAdminDecoratorTransformStringToLowerCase(isArray, {
        toClassOnly: reqOptions.lower,
        toPlainOnly: resOptions.lower,
      }),
    )
  }

  if (reqOptions.upper || resOptions.upper) {
    decorators.push(
      WalnutAdminDecoratorTransformStringToUpperCase(isArray, {
        toClassOnly: reqOptions.upper,
        toPlainOnly: resOptions.upper,
      }),
    )
  }

  if (reqOptions.booleanString || resOptions.booleanString) {
    decorators.push(
      WalnutAdminDecoratorTransformStringBoolean(isArray, {
        toClassOnly: reqOptions.booleanString,
        toPlainOnly: resOptions.booleanString,
      }),
    )
  }

  if (resOptions.phoneNumberMask) {
    decorators.push(
      WalnutAdminDecoratorTransformStringPhoneNumberMask(isArray, {
        toPlainOnly: true,
      }),
    )
  }

  if (resOptions.emailMask) {
    decorators.push(
      WalnutAdminDecoratorTransformStringEmailMask(isArray, {
        toPlainOnly: true,
      }),
    )
  }

  return applyDecorators(...decorators)
}

export function WalnutAdminDecoratorTransformStringToTrim(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => v.trim().replace(/\s{2,}/g, ' '))
    }

    return value.trim().replace(/\s{2,}/g, ' ')
  }, options)
}

export function WalnutAdminDecoratorTransformStringToLowerCase(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => v.toLowerCase())
    }

    return value.toLowerCase()
  }, options)
}

export function WalnutAdminDecoratorTransformStringToUpperCase(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => v.toUpperCase())
    }

    return value.toUpperCase()
  }, options)
}

function transformBooleanStringToBoolean(v: string) {
  return v === 'true' ? true : v === 'false' ? false : v
}

export function WalnutAdminDecoratorTransformStringBoolean(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => transformBooleanStringToBoolean(v))
    }

    return transformBooleanStringToBoolean(value)
  }, options)
}
