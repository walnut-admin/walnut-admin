import type { ClassConstructor, TransformOptions } from 'class-transformer'
import type { Recordable } from 'easy-fns-ts'
import { applyDecorators } from '@nestjs/common'
import { maskSensitiveFields } from '@walnut-server/utils/mask'
import { Transform, Type } from 'class-transformer'
import { isNil } from 'lodash'
import { WalnutAdminDecoratorTransformDefault } from '../common/default'

function defaultReqOpt(): IWADTObjReqOpt {
  return {
  }
}

function defaultResOpt(): IWADTObjResOpt {
  return {
    maskSensitive: false,
  }
}

export function WalnutAdminDecoratorTransformerObject(
  obj: ClassConstructor<any>,
  options?: IWADTObjOpt,
  isArray?: boolean,
  defaultValue?: unknown,
): PropertyDecorator {
  const decorators: PropertyDecorator[] = []

  // Only add Type decorator when obj is not the base Object class
  // Adding Type(() => Object) causes class-transformer to convert plain objects to empty objects
  if (obj !== Object) {
    decorators.push(Type(() => obj))
  }

  const reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  if (resOptions.maskSensitive) {
    decorators.push(
      WalnutAdminDecoratorTransformObjectMaskSensitive(isArray, {
        toPlainOnly: true,
      }),
    )
  }

  if (reqOptions.defaultTransform || resOptions.defaultTransform) {
    decorators.push(
      WalnutAdminDecoratorTransformDefault(defaultValue, isArray, {
        toClassOnly: reqOptions.defaultTransform,
        toPlainOnly: resOptions.defaultTransform,
      }),
    )
  }

  return applyDecorators(...decorators)
}

export function WalnutAdminDecoratorTransformObjectMaskSensitive(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: Recordable | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: Recordable) => maskSensitiveFields(v))
    }

    return maskSensitiveFields(value)
  }, options)
}
