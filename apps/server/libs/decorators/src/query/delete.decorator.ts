import {
  DefaultValuePipe,
  ParseIntPipe,
  Query,
} from '@nestjs/common'
import { WalnutAdminPipeParamEnum } from '@walnut/pipes'

import { merge } from 'lodash'

const delConst = {
  0: 0,
  1: 1,
} as const

interface IWalnutAdminDecoratorQueryDeleteCascadeOptions {
  default?: string | number | boolean | any[]
  type?: any
}

// delete joint document query
export function WalnutAdminDecoratorQueryDeleteCascade(options?: IWalnutAdminDecoratorQueryDeleteCascadeOptions) {
  const o = merge({ required: false, type: Number, default: 0 }, options)
  const arr = [
    new DefaultValuePipe(o.default),
    new ParseIntPipe(),
    new WalnutAdminPipeParamEnum(delConst, { required: false }),
  ]

  // walnut delete joint
  return Query('_cascade', ...arr)
}
