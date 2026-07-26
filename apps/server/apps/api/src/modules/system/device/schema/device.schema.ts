import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'
import { HydratedDocument, Model } from 'mongoose'
import { SharedGeoPointDTO, SharedHardwareDTO, SharedHeightWidthDTO, SharedIpLocationHistoryDTO, SharedLocationDTO, SharedUserAgentDTO } from '@/common/dto/shared.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualMonitorUserThroughDeviceId, IVirtualMonitorUser } from '@/common/model/virtual/monitorUser'

export type ISysDeviceDocument = HydratedDocument<
  SysDeviceModel & ISysDeviceMethods & IVirtualMonitorUser
>

export type ISysDeviceModel = Model<ISysDeviceDocument>
  & ISysDeviceStatics

interface ISysDeviceMethods {
  getLocationString: () => string
}

interface ISysDeviceStatics { }

@Schema({
  collection: WalnutDBCollectionName.DEVICE,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysDeviceModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device name, normally cannot change',
    },
  })
  @Prop({ type: String, required: true, unique: true })
  deviceName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'device id, also maybe known as fingerprint for client',
    },
  })
  @Prop({ type: String, required: true, unique: true, index: true })
  deviceId: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedUserAgentDTO), {
    swaggerOptions: {
      title: 'device user agent information',
      required: true,
    },
  })
  @Prop({ type: SharedUserAgentDTO, _id: false, required: true })
  deviceInfo: SharedUserAgentDTO

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedHardwareDTO), {
    swaggerOptions: {
      title: 'hardware information',
    },
  })
  @Prop({ type: SharedHardwareDTO, _id: false })
  hardwareInfo: SharedHardwareDTO

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedLocationDTO), {
    swaggerOptions: {
      title: 'location information',
    },
  })
  @Prop({ type: SharedLocationDTO, _id: false })
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
  @Prop({
    type: [SharedIpLocationHistoryDTO],
    _id: false,
    default: [],
  })
  locationHistory: SharedIpLocationHistoryDTO[]

  @WalnutAdminDecoratorFieldObject(SharedHeightWidthDTO, {
    swaggerOptions: {
      title: 'screen resolution',
    },
  })
  @Prop({
    _id: false,
    type: {
      height: Number,
      width: Number,
    },
  })
  sr: { height: number, width: number }

  @WalnutAdminDecoratorFieldObject(SharedHeightWidthDTO, {
    swaggerOptions: {
      title: 'view port',
    },
  })
  @Prop({
    _id: false,
    type: {
      height: Number,
      width: Number,
    },
  })
  vp: { height: number, width: number }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  @Prop({ type: String, default: null })
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
  @Prop({ type: [String], required: true })
  ipHistory: string[]

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device active status',
    },
  })
  @Prop({ type: Boolean, default: false })
  active: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device lock status',
    },
  })
  @Prop({ type: Boolean, default: false })
  locked: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device ban status',
    },
  })
  @Prop({ type: Boolean, default: false })
  banned: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'device private/incognito',
    },
  })
  @Prop({ type: Boolean, default: false })
  private: boolean

  @WalnutAdminDecoratorFieldObject(RealPartialType(SharedGeoPointDTO), {
    swaggerOptions: {
      title: 'geo location, longitude and latitude',
    },
  })
  @Prop({ type: SharedGeoPointDTO, _id: false })
  geoLocation: SharedGeoPointDTO

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'device risk score',
    },
  })
  @Prop({ type: Number, default: 0, min: 0, max: 100 })
  riskScore: number
}

export const SysDeviceSchema
  = SchemaFactory.createForClass(SysDeviceModel)

// Virtual
addVirtualMonitorUserThroughDeviceId(SysDeviceSchema)

// TODO methods demo usage
SysDeviceSchema.methods.getLocationString = function (): string {
  const thisDevice = this as SysDeviceModel
  const loc = thisDevice.locationInfo
  if (loc === null)
    return 'Unknown'

  if (loc.region === loc.city)
    return `${loc.country} ${loc.region}`

  return [
    loc.country,
    loc.region,
    loc.city,
  ].filter(Boolean).join(' ')
}
