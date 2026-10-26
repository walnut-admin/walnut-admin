import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'
import { SharedGeoPointDTO, SharedHardwareDTO, SharedHeightWidthDTO, SharedIpLocationHistoryDTO, SharedLocationDTO, SharedUserAgentDTO } from '@/common/dto/shared.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

/**
 * Phase 5a 起本 schema 去除全部 mongoose 装饰（@Schema/@Prop/@Virtual 与模型注册
 * 早已随迁移摘除），仅作为 DTO 链的校验/swagger 元数据基座保留。
 * PG 实体见 ../entity/device.entity.ts（phase2 4.8）。
 */

export class SysDeviceModel extends WalnutAdminCommonBasicModel {
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
