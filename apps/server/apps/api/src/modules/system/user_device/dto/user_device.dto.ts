import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldBoolean, WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'
import { RealPickType } from '@walnut/utils/dto'
import { CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'
import { AppMonitorUserDTO } from '@/modules/app/monitor/user/dto/user.dto'
import { SysUserDeviceModel } from '../schema/user_device.schema'

export class SysUserDeviceDTO extends SysUserDeviceModel {
  constructor(partial?: Partial<SysUserDeviceDTO>) {
    super()
    Object.assign(this, partial)
  }
}

class SysUserDeviceListItemDTO extends IntersectionType(
  RealPickType(SysUserDeviceDTO, ['deviceId', 'deviceName', 'locked', 'lastActiveAt'] as const),
  RealPickType(AppMonitorUserDTO, ['auth'] as const),
) {
  constructor(partial?: Partial<SysUserDeviceListItemDTO>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'deviceType',
      description: '设备类型',
    },
  })
  deviceType: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'thisDevice',
      description: '是否为当前设备',
    },
  })
  current: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'location',
      description: '设备位置',
    },
  })
  location: string
}

export class SysUserDeviceListDTO extends CreateWalnutAdminResponseListDTO(SysUserDeviceListItemDTO) {}

export class SysUserDeviceUpdateNameDTO extends RealPickType(SysUserDeviceDTO, ['deviceName'] as const) {}
