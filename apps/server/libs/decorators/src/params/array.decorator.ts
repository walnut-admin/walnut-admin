import type {
  PipeTransform,
  Type,
} from '@nestjs/common'
import {
  DefaultValuePipe,
  Param,
  ParseArrayPipe,
} from '@nestjs/common'
import { WalnutAdminPipeRequired } from '@walnut/pipes'

import { merge } from 'lodash'

interface IWalnutAdminDecoratorParamArrayOptions {
  fieldName: string
  required?: boolean
  type?: Type<unknown>
  separator?: string
  default?: string | number | boolean | any[]
  otherPipes?: (Type<PipeTransform> | PipeTransform)[]
}

function getDefaultOptions(): Partial<IWalnutAdminDecoratorParamArrayOptions> {
  return {
    separator: ',',
    required: true,
    type: String,
    otherPipes: [],
  }
}

type PipeType = Type<PipeTransform> | PipeTransform | DefaultValuePipe<any>

export function WalnutAdminDecoratorParamArray(options: IWalnutAdminDecoratorParamArrayOptions) {
  const o = merge(getDefaultOptions(), options)
  const arr: PipeType[] = [
    new DefaultValuePipe(o.default),
    new ParseArrayPipe({ items: o.type, separator: o.separator }),
    ...(o.otherPipes || []),
  ]

  if (o.required) {
    arr.unshift(new WalnutAdminPipeRequired())
  }

  return Param(o.fieldName, ...arr)
}
