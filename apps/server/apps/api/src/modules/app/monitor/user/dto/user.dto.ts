import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'
import { RealPartialType, RealPickType } from '@walnut/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SharedLocationDTO, SharedUserAgentDTO } from '@/common/dto/shared.dto'
import { WalnutAdminVirtualDeviceDTO } from '@/common/model/virtual/device'
import { WalnutAdminVirtualUserDTO } from '@/common/model/virtual/user'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'
import { AppMonitorUserModel } from '../schema/user.schema'

export class AppMonitorUserDTO extends IntersectionType(AppMonitorUserModel, WalnutAdminVirtualUserDTO, WalnutAdminVirtualDeviceDTO) {
  constructor(partial: Partial<AppMonitorUserDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// update state
export class AppMonitorUserDTOUpdateState extends RealPickType(RealPartialType(AppMonitorUserDTO), ['visitorId', 'deviceId', 'userId', 'auth', 'focus', 'left', 'currentRouter'] as const) { }

class AppMonitorUserDTORequest extends IntersectionType(
  RealPartialType(AppMonitorUserDTO),
  RealPartialType(RealPickType(SharedLocationDTO, ['country'] as const)),
  RealPartialType(RealPickType(SharedUserAgentDTO, ['os', 'browser'] as const)),
  RealPartialType(RealPickType(SysUserDTOSafe, ['userName'] as const)),
) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  @IsOptional()
  @Expose()
  ip: string
}

// list
export class AppMonitorUserDTOListRequest extends CreateWalnutAdminRequestListDTO(AppMonitorUserDTORequest) { }

export class AppMonitorUserDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(AppMonitorUserDTO),
) { }

// read
export class AppMonitorUserDTOReadResponse extends AppMonitorUserDTO {}
