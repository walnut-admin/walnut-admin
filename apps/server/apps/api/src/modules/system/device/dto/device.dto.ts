import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'
import { SharedLngLatDTO, SharedLocationDTO, SharedTimeDTO } from '@/common/dto/shared.dto'
import { SysUserDTOSafe } from '../../user/dto/user.dto'
import { SysDeviceModel } from '../schema/device.schema'

export class SysDeviceDTO extends SysDeviceModel {
  constructor(partial?: Partial<SysDeviceDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysDeviceDTOSafe extends RealOmitType(SysDeviceDTO, [] as const) {
  constructor(partial?: Partial<SysDeviceDTOSafe>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'location',
    },
  })
  location: string
}

// initial
export class SysDeviceDTOInitialRequest extends RealPickType(SysDeviceDTOSafe, ['deviceName', 'sr', 'vp', 'hardwareInfo', 'deviceInfo', 'private'] as const) {
  constructor(partial?: Partial<SysDeviceDTOInitialRequest>) {
    super()
    Object.assign(this, partial)
  }
}

// initial
export class SysDeviceDTOInitialResponse extends IntersectionType(SharedLocationDTO, SharedLngLatDTO, RealPickType(SysDeviceDTOSafe, ['deviceId'] as const)) {
  constructor(partial?: Partial<SysDeviceDTOInitialResponse>) {
    super()
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'country code',
    },
  })
  countryCode: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'timezone',
    },
  })
  timezone: string
}

// list
export class SysDeviceDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDeviceDTOSafe),
) { }

export class SysDeviceDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPickType(RealPartialType(SysDeviceDTOSafe), ['_id', 'active', 'banned', 'locked', 'deviceId', 'riskScore', 'deviceName', 'sr', 'hardwareInfo', 'deviceInfo', 'locationInfo'] as const),
) { }

// read
export class SysDeviceDTOReadResponse extends SysDeviceDTOSafe { }

// history users
export class SysDeviceDTOHistoryUsersResponse extends IntersectionType(RealPickType(SysUserDTOSafe, ['_id', 'nickName', 'userName'] as const), RealPickType(SharedTimeDTO, ['lastActiveAt'] as const)) {
  constructor(partial?: Partial<SysDeviceDTOHistoryUsersResponse>) {
    super()
    Object.assign(this, partial)
  }
}
