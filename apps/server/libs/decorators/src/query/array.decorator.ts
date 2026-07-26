import type {
  PipeTransform,
  Type,
} from '@nestjs/common'
import {
  DefaultValuePipe,
  ParseArrayPipe,
  Query,
} from '@nestjs/common'
import { WalnutAdminPipeRequired } from '@walnut-server/pipes'

import { merge } from 'lodash'

interface IWalnutAdminDecoratorQueryArrayOptions {
  fieldName: string
  required?: boolean
  type?: Type<unknown>
  separator?: string
  default?: string | number | boolean | any[]
  otherPipes?: (Type<PipeTransform> | PipeTransform)[]
}

function getDefaultOptions(): Partial<IWalnutAdminDecoratorQueryArrayOptions> {
  return {
    separator: ',',
    required: true,
    type: String,
    otherPipes: [],
  }
}

type PipeType = Type<PipeTransform> | PipeTransform | DefaultValuePipe<any>

export function WalnutAdminDecoratorQueryArray(options: IWalnutAdminDecoratorQueryArrayOptions) {
  const o = merge(getDefaultOptions(), options)
  const arr: PipeType[] = [
    new DefaultValuePipe(o.default),
    new ParseArrayPipe({ items: o.type, separator: o.separator }),
    ...(o.otherPipes || []),
  ]

  if (o.required) {
    arr.unshift(new WalnutAdminPipeRequired())
  }

  return Query(o.fieldName, ...arr)
}
