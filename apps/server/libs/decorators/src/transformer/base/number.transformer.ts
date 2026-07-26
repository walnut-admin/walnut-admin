import type { TransformOptions } from 'class-transformer'
import { applyDecorators } from '@nestjs/common'
import { Transform } from 'class-transformer'
import { isNil } from 'lodash'
import { round } from 'mathjs'
import { WalnutAdminDecoratorTransformDefault } from '../common/default'

const defaultReqOpt = (): IWADTNumReqOpt => ({})

function defaultResOpt(): IWADTNumResOpt {
  return {
    round: false,
  }
}

export function WalnutAdminDecoratorTransformerNumber(
  options?: IWADTNumOpt,
  isArray?: boolean,
  defaultValue?: unknown,
): PropertyDecorator {
  const decorators: PropertyDecorator[] = []

  const reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  if (typeof resOptions.precision === 'number') {
    decorators.push(
      WalnutAdminDecoratorTransformNumberPrecision(
        resOptions.precision,
        isArray,
        {
          toPlainOnly: true,
        },
      ),
    )
  }

  if (resOptions.round && typeof resOptions.precision === 'number') {
    decorators.push(
      WalnutAdminDecoratorTransformNumberRound(resOptions.precision, isArray, {
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

export function WalnutAdminDecoratorTransformNumberPrecision(
  precision: number,
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }) => {
    if (isNil(value))
      return null

    if (value === 0)
      return 0

    if (isArray && Array.isArray(value)) {
      return value.map(v => Number(Number(v).toFixed(precision)))
    }

    return Number(Number(value).toFixed(precision))
  }, options)
}

export function WalnutAdminDecoratorTransformNumberRound(
  precision: number,
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: number | null | undefined }) => {
    if (isNil(value))
      return 0

    if (value === 0)
      return 0

    if (isArray && Array.isArray(value)) {
      return value.map((v: number) => round(v, precision))
    }

    return round(value, precision)
  }, options)
}
