import type { Schema } from 'mongoose'
import type { IAppMonitorUserDocument } from '@/modules/app/monitor/user/schema/user.schema'
import { WalnutDBModelName, WalnutDBVirtualName } from '@walnut/db'
import { addVirtual } from '../virtual'

export function addVirtualMonitorUserThroughDeviceId(schema: Schema) {
  return addVirtual(schema, {
    virtualPath: WalnutDBVirtualName.MONITOR_USER,
    ref: WalnutDBModelName.APP_MONITOR_USER,
    localField: 'deviceId',
    foreignField: 'deviceId',
    justOne: true,
  })
}

export interface IVirtualMonitorUser {
  populated_monitor_user?: IAppMonitorUserDocument | null
}
