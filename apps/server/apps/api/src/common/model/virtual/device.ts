import { WalnutDBModelName, WalnutDBVirtualName } from '@walnut-server/db'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { Schema } from 'mongoose'
import { SysDeviceDTOSafe } from '@/modules/system/device/dto/device.dto'
import { ISysDeviceDocument } from '@/modules/system/device/schema/device.schema'
import { addVirtual } from '../virtual'

export function addVirtualDeviceThroughDeviceId(schema: Schema) {
  return addVirtual(schema, {
    virtualPath: WalnutDBVirtualName.DEVICE,
    ref: WalnutDBModelName.SYS_DEVICE,
    localField: 'deviceId',
    foreignField: 'deviceId',
    justOne: true,
  })
}

export interface IVirtualDevice {
  populated_device?: ISysDeviceDocument | null
}

export class WalnutAdminVirtualDeviceDTO {
  constructor(partial: Partial<WalnutAdminVirtualDeviceDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysDeviceDTOSafe, {
    swaggerOptions: {
      title: 'virtual device',
    },
  })
  populated_device: ISysDeviceDocument | null
}
