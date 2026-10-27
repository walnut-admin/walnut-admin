import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { CreateWalnutAdminRequestListDTO, CreateWalnutAdminResponseListDTO } from '@/common/dto/list.dto'
import { SharedLngLatDTO, SharedLocationDTO, SharedTimeDTO } from '@/common/dto/shared.dto'
import { SysUserDTOSafe } from '../../user/dto/user.dto'
import { SysDeviceEntity } from '../entity/device.entity'
import { SysDeviceModel } from '../schema/device.schema'

export class SysDeviceDTO extends SysDeviceModel {
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
