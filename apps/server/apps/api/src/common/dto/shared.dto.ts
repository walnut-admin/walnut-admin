import { Prop } from '@nestjs/mongoose'
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
  @Prop({ type: Number, max: 180, min: -180 })
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
  @Prop({ type: Number, max: 90, min: -90 })
  latitude: number
}

export class SharedHeightWidthDTO {
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'screen height',
      description: 'screen height in pixels',
    },
  })
  @Prop({ type: Number, required: true })
  height: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'screen width',
      description: 'screen width in pixels',
    },
  })
  @Prop({ type: Number, required: true })
  width: number
}

export class SharedGeoPointDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'geo point type',
    },
  })
  @Prop({ type: String, default: 'Point', enum: ['Point'], required: true })
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
  @Prop([{ type: Number, required: true }])
  coordinates: number[]
}

export class SharedUserAgentDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operating system',
    },
  })
  @Prop({ type: String })
  os: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'browser',
    },
  })
  @Prop({ type: String })
  browser: string

  @WalnutAdminDecoratorFieldEnum(() => DeviceTypeConst, {
    default: DeviceTypeConst.BOT,
    swaggerOptions: {
      title: 'device type, desktop, mobile, tablet, bot',
      example: DeviceTypeConst.BOT,
    },
  })
  @Prop({
    type: () => DeviceTypeConst,
    enum: [...Object.values(DeviceTypeConst)],
    default: DeviceTypeConst.BOT,
  })
  type: IDeviceTypeConst

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'net work type, get from `navigator.connection.effectiveType`',
    },
  })
  @Prop({ type: String })
  netType: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'platform, get from `navigator.platform`',
    },
  })
  @Prop({ type: String })
  platform: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Internet Service Provider, get from `https://api.ip.sb/geoip`',
    },
  })
  @Prop({ type: String })
  isp: string
}

export class SharedHardwareDTO {
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'cpu cores',
    },
  })
  @Prop({ type: Number })
  cpuCores: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'memory',
      description: 'memory in GB',
    },
  })
  @Prop({ type: Number })
  memory: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'gpu',
    },
  })
  @Prop({ type: String })
  gpu: string
}

export class SharedLocationDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'country',
    },
  })
  @Prop({ type: String })
  country: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'region',
    },
  })
  @Prop({ type: String })
  region: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'city',
    },
  })
  @Prop({ type: String })
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
  @Prop({ type: Date })
  lastActiveAt: Date
}

export class SharedIpLocationHistoryDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'IP address',
    },
  })
  @Prop({ type: String, required: true })
  ip: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedLocationDTO), {
    swaggerOptions: {
      title: 'location information',
    },
  })
  @Prop({ type: SharedLocationDTO, _id: false })
  location: SharedLocationDTO

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'timestamp when this IP was recorded',
    },
  })
  @Prop({ type: Number, required: true })
  timestamp: number
}
