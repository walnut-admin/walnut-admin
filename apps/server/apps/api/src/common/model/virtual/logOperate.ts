import type { Schema } from 'mongoose'
import type { ISysLogOperateDocument } from '@/modules/system/logs/operate/schema/log.operate.schema'
import { WalnutDBModelName, WalnutDBVirtualName } from '@walnut/db'
import { addVirtual } from '../virtual'

export function addVirtualLogOperateThroughLogId(schema: Schema, localeField: string = 'logOperateId') {
  return addVirtual(schema, {
    virtualPath: WalnutDBVirtualName.LOG_OPERATE,
    ref: WalnutDBModelName.SYS_LOG_OPERATE,
    localField: localeField,
    foreignField: '_id',
    justOne: true,
  })
}

export interface IVirtualLogOperate {
  populated_log_operate?: ISysLogOperateDocument | null
}
