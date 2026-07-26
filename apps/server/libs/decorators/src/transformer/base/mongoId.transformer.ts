import type { TransformOptions } from 'class-transformer'
import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { isNil } from 'lodash'
import { Types } from 'mongoose'

function defaultReqOpt(): IWADTMIdReqOpt {
  return {
    toObjectId: true,
  }
}

function defaultResOpt(): IWADTMIdResOpt {
  return {
    toString: true,
  }
}

export function WalnutAdminDecoratorTransformerMongoId(
  options?: IWADTMIdOpt,
  isArray?: boolean,
): PropertyDecorator {
  const decorators: PropertyDecorator[] = []

  const reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  if (reqOptions.toObjectId) {
    decorators.push(
      WalnutAdminDecoratorTransformStringIdToMongoId(isArray, {
        toClassOnly: true,
        toPlainOnly: false,
      }),
    )
  }

  if (resOptions.toString) {
    decorators.push(
      WalnutAdminDecoratorTransformMongoIdToStringId(isArray, {
        toPlainOnly: true,
        toClassOnly: false,
      }),
    )
  }

  return applyDecorators(...decorators)
}

export function WalnutAdminDecoratorTransformMongoIdToStringId(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => v.toString())
    }

    return value.toString()
  }, options)
}

export function WalnutAdminDecoratorTransformStringIdToMongoId(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value))
      return null

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => Types.ObjectId.createFromHexString(v))
    }

    return Types.ObjectId.createFromHexString(value)
  }, options)
}
