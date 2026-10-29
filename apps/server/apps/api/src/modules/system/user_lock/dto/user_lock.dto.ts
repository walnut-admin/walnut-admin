import { IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { Recordable } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysUserDeviceDTO } from '../../user_device/dto/user_device.dto'
import { ILockModeConst, LockModeConst } from '../lock.const'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user_lock.schema.ts 的 SysUserLockModel
// 改名 SysUserLockDTOBase，SysUserLockRouteRaw / SysUserLockRouteType 随基座类一并搬入），
// 装饰器与字段本体零改动

class SysUserLockRouteRaw {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'lock route name',
    },
  })
  name: string

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  query: Recordable

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  params: Recordable
}

class SysUserLockRouteType extends RealPartialType(SysUserLockRouteRaw) { }

export class SysUserLockDTOBase extends WalnutAdminCommonBasicModel {
  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldObject(SysUserLockRouteType, {
    swaggerOptions: {
      title: 'user lock route',
    },
  })
  lockRoute: InstanceType<typeof SysUserLockRouteType> | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'lock password hash',
    },
  })
  lockPwdHash: string

  @WalnutAdminDecoratorFieldEnum(() => LockModeConst, {
    default: LockModeConst.DEFAULT,
    swaggerOptions: {
      title: 'lock mode, default, idle, security',
      example: LockModeConst.DEFAULT,
    },
  })
  lockMode: ILockModeConst

  @WalnutAdminDecoratorFieldNumber({
    default: 600,
    swaggerOptions: {
      title: 'lock idle seconds',
    },
  })
  lockIdleSec: number

  @WalnutAdminDecoratorFieldNumber({
    default: 60,
    swaggerOptions: {
      title: 'lock security seconds',
    },
  })
  lockSecuritySec: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'lock cross device?',
    },
  })
  lockCrossDevice: boolean
}

// B7b 迁移注记：原 schema 处的 pre('save') bcrypt hash 钩子已迁到 PG 仓库的写入路径
// （SysUserLockRepositoryService.insertOrUpdateUserLockPre，写入路径全覆盖）；
// 本基座仅承载 DTO 校验/swagger 元数据（模型注册已摘除，钩子不再有执行时机）。

export class SysUserLockDto extends SysUserLockDTOBase {
  constructor(partial: Partial<SysUserLockDto>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserLockDoLockDto extends RealPartialType(RealPickType(SysUserLockDto, ['lockRoute'] as const)) {}

export class SysUserLockUnLockDto extends RealPartialType(RealPickType(SysUserLockDto, ['lockPwdHash'] as const)) {}

/**
 * P2-26（2026-10-29）：锁屏偏好写入通道（`PATCH /system/user/lock/preference`）。
 *
 * 旧实现没有任何端点写 `lockMode` / `lockPwdHash` / `lockCrossDevice` /
 * `lockIdleSec` / `lockSecuritySec`，security 模式不可达。`lockPwdHash` 字段沿用
 * DTO 既有命名，入参是**明文**，仓库写入路径 `insertOrUpdateUserLockPre` 负责
 * bcrypt 加盐（P1-10 收口后的同款 hash 路径）；响应不回显该列。
 */
export class SysUserLockPreferenceUpdateDto extends RealPartialType(RealPickType(SysUserLockDto, ['lockPwdHash', 'lockMode', 'lockIdleSec', 'lockSecuritySec', 'lockCrossDevice'] as const)) {}

export class SysUserLockPreferenceDTO extends IntersectionType(RealPickType(SysUserDeviceDTO, ['locked'] as const), RealPickType(SysUserLockDto, ['lockRoute', 'lockCrossDevice', 'lockMode', 'lockIdleSec', 'lockSecuritySec'] as const)) {
  constructor(partial?: Partial<SysUserLockPreferenceDTO>) {
    super()
    Object.assign(this, partial)
  }
}
