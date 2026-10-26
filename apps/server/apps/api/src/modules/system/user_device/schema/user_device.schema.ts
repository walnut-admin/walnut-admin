import {

  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'

import { ValueOf } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
/**
 * B6 起本 schema 不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
 * 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
 * userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。
 */
export const DeviceLinkConst = {
  USER: 'user',
  ADMIN: 'admin',
  SYSTEM: 'system',
} as const

type IDeviceLinkConst = ValueOf<typeof DeviceLinkConst>

export class SysUserDeviceModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'device name, user can change this freely',
    },
  })
  deviceName: string

  // B6：PG 侧 user_id 是 uuid（FK → sys_user(id)，phase2 4.9）；属性 TS 类型随列型
  // 放开为 string（uuid 校验在 DTO 子类重声明接管）
  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id',
    },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'user/device link or not',
    },
  })
  link: boolean

  @WalnutAdminDecoratorFieldEnum(() => DeviceLinkConst, {
    default: DeviceLinkConst.SYSTEM,
    swaggerOptions: {
      title: 'link type, user, admin, system',
      example: DeviceLinkConst.SYSTEM,
    },
  })
  linkType: IDeviceLinkConst

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'locked?',
    },
  })
  locked: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'updatedAt, used as `lastActiveAt`',
      required: false,
    },
  })
  @IsOptional({})
  lastActiveAt: Date

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'trusted?',
    },
  })
  trusted: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'trusted expired at',
      required: false,
    },
  })
  @IsOptional({})
  trustedExpiredAt: Date
}

// Virutal
