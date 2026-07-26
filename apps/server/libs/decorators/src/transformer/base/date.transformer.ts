import type { TransformOptions } from 'class-transformer'
import { applyDecorators } from '@nestjs/common'
import { AppDayjs } from '@walnut/utils/dayjs'

import { Transform } from 'class-transformer'
import { isNil } from 'lodash'

const defaultReqOpt = (): IWADTDateReqOpt => ({})

function defaultResOpt(): IWADTDateResOpt {
  return {
    format: 'YYYY-MM-DD HH:mm:ss',
  }
}

export function WalnutAdminDecoratorTransformerDate(
  options?: IWADTDateOpt,
  isArray?: boolean,
): PropertyDecorator {
  const decorators: PropertyDecorator[] = []

  const _reqOptions = Object.assign(defaultReqOpt(), options?.req ?? {})
  const resOptions = Object.assign(defaultResOpt(), options?.res ?? {})

  if (typeof resOptions.format === 'string') {
    decorators.push(
      WalnutAdminDecoratorTransformDateToString(resOptions.format, isArray, {
        toPlainOnly: true,
      }),
    )
  }

  return applyDecorators(...decorators)
}

export function WalnutAdminDecoratorTransformDateToString(
  format?: string,
  isArray: boolean = false,
  options: TransformOptions = {},
): PropertyDecorator {
  return Transform(({ value }: { value: string | null | undefined }) => {
    if (isNil(value)) {
      return null
    }

    if (isArray && Array.isArray(value)) {
      return value.map((v: string) => AppDayjs(v).format(format))
    }

    return AppDayjs(value).format(format)
  }, options)
}
