import { IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { CreateWalnutAdminResponseListDTO } from '@walnut-server/list'
import { RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { ValueOf } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '../../shared/base.model'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user_device.schema.ts 的 SysUserDeviceModel
// 改名 SysUserDeviceDTOBase，DeviceLinkConst / IDeviceLinkConst 随基座类一并搬入），
// 装饰器与字段本体零改动
//
// B6 起本基座不再注册进 Mongoose（模型注册随迁移摘除），仅作为 DTO 链的
// 校验/swagger 元数据基座保留；@Prop / virtual 不再有运行时语义。
// userId 的 uuid 校验在 DTO 子类重声明（同 B1 模板）；deviceId 保持字符串业务键。

export const DeviceLinkConst = {
  USER: 'user',
  ADMIN: 'admin',
  SYSTEM: 'system',
} as const

type IDeviceLinkConst = ValueOf<typeof DeviceLinkConst>

export class SysUserDeviceDTOBase extends WalnutAdminCommonBasicModel {
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

export class SysUserDeviceDTO extends SysUserDeviceDTOBase {
  constructor(partial?: Partial<SysUserDeviceDTO>) {
    super()
    Object.assign(this, partial)
  }
}

// 批 6：原 `RealPickType(AppMonitorUserDTO, ['auth'])`（内核 → app monitor DTO 的反向依赖）
// 收成同名 wire 字段的本地类 —— 装饰器与字段顺序不变，openapi 零 diff。
class SysUserDeviceAuthDTO {
  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth or not',
    },
  })
  auth: boolean
}

class SysUserDeviceListItemDTO extends IntersectionType(
  RealPickType(SysUserDeviceDTO, ['deviceId', 'deviceName', 'locked', 'lastActiveAt'] as const),
  SysUserDeviceAuthDTO,
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
