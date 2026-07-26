import { IntersectionType } from '@nestjs/swagger'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { SysUserDeviceDTO } from '../../user_device/dto/user_device.dto'
import { SysUserLockModel } from '../schema/user_lock.schema'

export class SysUserLockDto extends SysUserLockModel {
  constructor(partial: Partial<SysUserLockDto>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserLockDoLockDto extends RealPartialType(RealPickType(SysUserLockDto, ['lockRoute'] as const)) {}

export class SysUserLockUnLockDto extends RealPartialType(RealPickType(SysUserLockDto, ['lockPwdHash'] as const)) {}

export class SysUserLockPreferenceDTO extends IntersectionType(RealPickType(SysUserDeviceDTO, ['locked'] as const), RealPickType(SysUserLockDto, ['lockRoute', 'lockCrossDevice', 'lockMode', 'lockIdleSec', 'lockSecuritySec'] as const)) {
  constructor(partial?: Partial<SysUserLockPreferenceDTO>) {
    super()
    Object.assign(this, partial)
  }
}
