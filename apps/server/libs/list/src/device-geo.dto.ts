/**
 * 设备定位相关 DTO（设备类型 / 经纬度 / 屏幕尺寸 / UA / 硬件 / IP 归属地）。
 *
 * 供设备 / IP 定位相关数据面消费，与列表分页无关。历史文件名是 `shared.dto.ts`（命名漂移，
 * 容易误以为属于列表共享契约），本批只改文件名与引用路径，类名保持不变（类名属于
 * API 面）。
 */
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'
import { IsOptional } from 'class-validator'
import { ValueOf } from 'easy-fns-ts'

export const DeviceTypeConst = {
  DESKTOP: 'desktop',
  MOBILE: 'mobile',
  TABLET: 'tablet',
  BOT: 'bot',
} as const

export type IDeviceTypeConst = ValueOf<typeof DeviceTypeConst>

export class SharedLngLatDTO {
  @WalnutAdminDecoratorFieldNumber({
    validateOptions: {
      min: -180,
      max: 180,
    },
    swaggerOptions: {
      title: 'longitude',
    },
  })
  longitude: number

  @WalnutAdminDecoratorFieldNumber({
    validateOptions: {
      min: -90,
      max: 90,
    },
    swaggerOptions: {
      title: 'latitude',
    },
  })
  latitude: number
}

export class SharedHeightWidthDTO {
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'screen height',
      description: 'screen height in pixels',
    },
  })
  height: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'screen width',
      description: 'screen width in pixels',
    },
  })
  width: number
}

export class SharedGeoPointDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'geo point type',
    },
  })
  type: string

  @WalnutAdminDecoratorFieldNumber({
    isArray: true,
    arrayOptions: {
      minSize: 2,
      maxSize: 2,
      unique: true,
    },
    swaggerOptions: {
      title: 'geo point coordinates, longitude and latitude',
      description: 'longitude and latitude, in order of [longitude, latitude]',
    },
  })
  coordinates: number[]
}

export class SharedUserAgentDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operating system',
    },
  })
  os: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'browser',
    },
  })
  browser: string

  @WalnutAdminDecoratorFieldEnum(() => DeviceTypeConst, {
    default: DeviceTypeConst.BOT,
    swaggerOptions: {
      title: 'device type, desktop, mobile, tablet, bot',
      example: DeviceTypeConst.BOT,
    },
  })
  type: IDeviceTypeConst

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'net work type, get from `navigator.connection.effectiveType`',
    },
  })
  netType: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'platform, get from `navigator.platform`',
    },
  })
  platform: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Internet Service Provider, get from `https://api.ip.sb/geoip`',
    },
  })
  isp: string
}

export class SharedHardwareDTO {
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'cpu cores',
    },
  })
  cpuCores: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'memory',
      description: 'memory in GB',
    },
  })
  memory: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'gpu',
    },
  })
  gpu: string
}

export class SharedLocationDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'country',
    },
  })
  country: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'region',
    },
  })
  region: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'city',
    },
  })
  city: string
}

export class SharedTimeDTO {
  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'last active time',
      required: false,
    },
  })
  @IsOptional({})
  lastActiveAt: Date
}

export class SharedIpLocationHistoryDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'IP address',
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedLocationDTO), {
    swaggerOptions: {
      title: 'location information',
    },
  })
  location: SharedLocationDTO

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'timestamp when this IP was recorded',
    },
  })
  timestamp: number
}
