import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
/**
 * B6 起本 schema 不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
 * 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
 * userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。
 */
export class AppMonitorUserModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'fingerprint for auth and no auth users',
    },
  })
  visitorId: string

  // B6：PG 侧 user_id 是可空 uuid 松引用（phase2 4.21）；属性 TS 类型随列型放开为
  // string（uuid 校验在 DTO 子类重声明接管）
  @Expose()
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'device id' },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth or not',
    },
  })
  auth: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'focus on current page or not',
    },
  })
  focus: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'left page or not',
    },
  })
  left: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'current page router',
    },
  })
  currentRouter: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'createdAt, used as `firstVisitAt`',
      required: false,
    },
  })
  @IsOptional({})
  firstVisitAt: Date

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'updatedAt, used as `lastActiveAt`',
      required: false,
    },
  })
  @IsOptional({})
  lastActiveAt: Date
}

// Virutal
