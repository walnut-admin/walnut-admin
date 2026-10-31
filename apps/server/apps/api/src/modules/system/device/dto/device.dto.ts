import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO, SharedGeoPointDTO, SharedHardwareDTO, SharedHeightWidthDTO, SharedIpLocationHistoryDTO, SharedLocationDTO, SharedTimeDTO, SharedUserAgentDTO } from '@walnut-server/list'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'
import { SysDeviceEntity } from '../entity/device.entity'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/device.schema.ts 的 SysDeviceModel
// 改名 SysDeviceDTOBase），装饰器与字段本体零改动
//
// Phase 5a 起本基座去除全部 mongoose 装饰（@Schema/@Prop/@Virtual 与模型注册
// 早已随迁移摘除），仅作为 DTO 链的校验/swagger 元数据基座保留。
// PG 实体见 ../entity/device.entity.ts（phase2 4.8）。

export class SysDeviceDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device name, normally cannot change',
    },
  })
  deviceName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id, also maybe known as fingerprint for client',
    },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedUserAgentDTO), {
    swaggerOptions: {
      title: 'device user agent information',
      required: true,
    },
  })
  deviceInfo: SharedUserAgentDTO

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedHardwareDTO), {
    swaggerOptions: {
      title: 'hardware information',
    },
  })
  hardwareInfo: SharedHardwareDTO

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedLocationDTO), {
    swaggerOptions: {
      title: 'location information',
    },
  })
  locationInfo: SharedLocationDTO

  @WalnutAdminDecoratorFieldObject(SharedIpLocationHistoryDTO, {
    isArray: true,
    arrayOptions: {
      maxSize: 5,
    },
    swaggerOptions: {
      title: 'IP location history, synced with ipHistory',
      description: 'Stores up to 5 recent IP-location pairs',
    },
  })
  locationHistory: SharedIpLocationHistoryDTO[]

  @WalnutAdminDecoratorFieldObject(SharedHeightWidthDTO, {
    swaggerOptions: {
      title: 'screen resolution',
    },
  })
  sr: { height: number, width: number }

  @WalnutAdminDecoratorFieldObject(SharedHeightWidthDTO, {
    swaggerOptions: {
      title: 'view port',
    },
  })
  vp: { height: number, width: number }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    arrayOptions: {
      unique: true,
      minSize: 1,
      maxSize: 5,
    },
    swaggerOptions: {
      title: 'ip address, with history support',
      required: true,
    },
  })
  ipHistory: string[]

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device active status',
    },
  })
  active: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device lock status',
    },
  })
  locked: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device ban status',
    },
  })
  banned: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device private/incognito',
    },
  })
  private: boolean

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedGeoPointDTO), {
    swaggerOptions: {
      title: 'geo location, longitude and latitude',
    },
  })
  geoLocation: SharedGeoPointDTO

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'device risk score',
    },
  })
  riskScore: number
}

export class SysDeviceDTO extends SysDeviceDTOBase {
  constructor(partial?: Partial<SysDeviceDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.8）：B1 模板 —— @Expose 供响应序列化与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysDeviceDTOSafe extends SysDeviceDTO {
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

/**
 * B6：sys_device 的 sr / vp / geoLocation 已拍平为数值列（phase2 4.8），实体即 POJO；
 * 出参组装回 Mongo 版的嵌套对象形态（前端无感，menu meta 拍平组装的同款手法）。
 */
export function assembleSysDevice(entity: SysDeviceEntity) {
  return {
    ...entity,
    sr: entity.srHeight === null && entity.srWidth === null
      ? undefined
      : { height: entity.srHeight, width: entity.srWidth },
    vp: entity.vpHeight === null && entity.vpWidth === null
      ? undefined
      : { height: entity.vpHeight, width: entity.vpWidth },
    geoLocation: entity.geoLongitude === null && entity.geoLatitude === null
      ? undefined
      : { type: 'Point', coordinates: [entity.geoLongitude, entity.geoLatitude] },
  }
}

// initial
export class SysDeviceDTOInitialRequest extends RealPickType(SysDeviceDTOSafe, ['deviceName', 'sr', 'vp', 'hardwareInfo', 'deviceInfo', 'private'] as const) {
  constructor(partial?: Partial<SysDeviceDTOInitialRequest>) {
    super()
    Object.assign(this, partial)
  }
}

// initial
/**
 * `POST /system/device/initial` 响应 —— 设备注册回显的公开面（wire 事实）：
 * `deviceId` 恒有；经纬度 / countryCode 来自 IP 定位，本地 IP（无定位数据）时缺省。
 * 旧版 IntersectionType 声明了从未下发的 country/region/city/timezone，与 wire 不符；
 * 本类只作 swagger 文档，构造入参与序列化字段集与旧实现一致。
 */
export class SysDeviceDTOInitialResponse {
  constructor(partial?: Partial<SysDeviceDTOInitialResponse>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id, also maybe known as fingerprint for client',
    },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'longitude',
      required: false,
    },
  })
  longitude?: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'latitude',
      required: false,
    },
  })
  latitude?: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'country code',
      required: false,
    },
  })
  countryCode?: string
}

// list
// L2 sort 白名单：admin device 卡片列表以 active/locked/banned 优先级降序排
// （views/system/device useState 初始 sort）；createdAt 有 idx_device_created_at
// DESC。active/locked/banned 无索引但 admin 在用 → 保留，见报告建议补索引
export class SysDeviceDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDeviceDTOSafe),
  { sortOnlyIn: ['active', 'locked', 'banned', 'createdAt', 'updatedAt'] },
) { }

export class SysDeviceDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPickType(RealPartialType(SysDeviceDTOSafe), ['id', 'active', 'banned', 'locked', 'deviceId', 'riskScore', 'deviceName', 'sr', 'hardwareInfo', 'deviceInfo', 'locationInfo'] as const),
) { }

// read
export class SysDeviceDTOReadResponse extends SysDeviceDTOSafe { }

// history users
export class SysDeviceDTOHistoryUsersResponse extends IntersectionType(RealPickType(SysUserDTOSafe, ['id', 'nickName', 'userName'] as const), RealPickType(SharedTimeDTO, ['lastActiveAt'] as const)) {
  constructor(partial?: Partial<SysDeviceDTOHistoryUsersResponse>) {
    super()
    Object.assign(this, partial)
  }
}
