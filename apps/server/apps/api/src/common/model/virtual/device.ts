import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { SysDeviceDTOSafe } from '@/modules/system/device/dto/device.dto'

/**
 * populate 出参（Phase 5a 起 mongoose virtual 已摘除；键名 `populated_device` 沿用
 * `WalnutDBVirtualName.DEVICE`，PG 通道组装后按此键挂载）。
 */
export class WalnutAdminVirtualDeviceDTO {
  constructor(partial: Partial<WalnutAdminVirtualDeviceDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysDeviceDTOSafe, {
    swaggerOptions: {
      title: 'virtual device',
    },
  })
  populated_device: SysDeviceDTOSafe | null
}
