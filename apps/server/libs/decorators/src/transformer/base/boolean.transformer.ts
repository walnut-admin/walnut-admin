import type { TransformOptions } from 'class-transformer'
import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { isNil } from 'lodash'

function defaultReqOpt(): IWADTBoolReqOpt {
  return {
    stringBoolean: true,
  }
}

function defaultResOpt(): IWADTBoolResOpt {
  return {
    stringBoolean: true,
  }
}

export function WalnutAdminDecoratorTransformerBoolean(
  options?: IWADTBoolOpt,
  isArray?: boolean,
): PropertyDecorator {
  const decorators: PropertyDecorator[] = []

  const reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  if (resOptions.stringBoolean || reqOptions.stringBoolean) {
    decorators.push(
      WalnutAdminDecoratorTransformStringBooleanInternal(isArray, {
        toClassOnly: reqOptions.stringBoolean,
        toPlainOnly: resOptions.stringBoolean,
      }),
    )
  }

  return applyDecorators(...decorators)
}

function transformBooleanString(v: string) {
  switch (v) {
    case 'true':
      return true
    case 'false':
      return false
    default:
      return v
  }
}

// Internal version for use within this file only
function WalnutAdminDecoratorTransformStringBooleanInternal(
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value)) {
      return null
    }

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => transformBooleanString(v))
    }

    return transformBooleanString(value)
  }, options)
}
