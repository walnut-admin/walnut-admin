import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { Recordable } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { ILockModeConst, LockModeConst } from '../lock.const'

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

export class SysUserLockModel extends WalnutAdminCommonBasicModel {
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

// B7b 迁移注记：原此处的 pre('save') bcrypt hash 钩子已迁到 PG 仓库的写入路径
// （SysUserLockRepositoryService.insertOrUpdateUserLockPre，写入路径全覆盖）；
// 本 schema 仅承载 DTO 校验/swagger 元数据（模型注册已摘除，钩子不再有执行时机）。
