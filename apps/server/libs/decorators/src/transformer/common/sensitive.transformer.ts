import type { TransformOptions } from 'class-transformer'
import { maskEmail, maskPhone } from '@walnut/utils/mask'
import { Transform } from 'class-transformer'
import { isNil } from 'lodash'

export function WalnutAdminDecoratorTransformStringEmailMask(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map(maskEmail)
    }

    return maskEmail(value)
  }, options)
}

export function WalnutAdminDecoratorTransformStringPhoneNumberMask(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map(maskPhone)
    }

    return maskPhone(value)
  }, options)
}
