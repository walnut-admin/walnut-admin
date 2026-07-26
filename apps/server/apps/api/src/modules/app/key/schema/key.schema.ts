import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName } from '@walnut-server/db'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType } from '@walnut-server/utils/dto'
import { ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export const AppKeyTypeConst = {
  RSA_PAIR: 'RSA_PAIR',
  AES_KEY_URL: 'AES_KEY_URL',
  JWT_AT: 'JWT_AT',
  JWT_RT: 'JWT_RT',
} as const

export type AppKeyTypeConstType = ValueOf<typeof AppKeyTypeConst>

export const AppKeyStatusConst = {
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  DISABLED: 'DISABLED',
} as const

export type AppKeyStatusConstType = ValueOf<typeof AppKeyStatusConst>

class AppKeyMetaTypeRaw {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'RSA Public Key (PEM)',
      description: 'PEM-formatted RSA public key for encryption or signature verification.',
      example: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...\n-----END PUBLIC KEY-----',
    },
  })
  publicKeyPem?: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'RSA Private Key (PEM)',
      description: 'PEM-formatted RSA private key for decryption or signature generation.',
      example: '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCQ...\n-----END PRIVATE KEY-----',
    },
  })
  privateKeyPem?: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Symmetric Key (Base64)',
      description: 'Base64-encoded symmetric encryption key (e.g., AES).',
      example: 'dGhpcyBpcyBhIDI1NiBiaXQga2V5IGZvciBBRVM=',
    },
  })
  keyB64?: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Initialization Vector (Base64)',
      description: 'Base64-encoded initialization vector (IV) for symmetric encryption.',
      example: 'dGhpcyBpcyBhIDEyOCBiaXQgSVY=',
    },
  })
  ivB64?: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'JWT / HMAC Secret',
      description: 'Plain secret string used for signing or verifying JWT tokens, or as an HMAC key.',
      example: 'jwt_secret_32bytes_super_secure_random_string',
    },
  })
  secret?: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'Key Bits',
      description: 'Key length in bits (e.g., 2048 for RSA, 256 for AES).',
      example: 256,
    },
  })
  bits?: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Cipher Suite',
      description: 'Algorithm / mode identifier (e.g., AES-256-CBC, RSA-OAEP-SHA256).',
      example: 'AES-256-CBC',
    },
  })
  cipher?: string
}

export class AppKeyMetaType extends RealPartialType(AppKeyMetaTypeRaw) { }

export type IAppKeyDocument = HydratedDocument<AppKeyModel & IAppKeyMethods>

export type IAppKeyModel = Model<IAppKeyDocument> & IAppKeyStatics

export interface IAppKeyMethods {}

export interface IAppKeyStatics { }

@Schema({
  collection: WalnutDBCollectionName.APP_KEY,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class AppKeyModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'app key',
      example: 'rsa-req-20250618-001',
      description: 'app key',
    },
  })
  @Prop({ type: String, unique: true, required: true })
  key: string

  @WalnutAdminDecoratorFieldEnum(() => AppKeyTypeConst, {
    swaggerOptions: {
      title: 'app key type',
      example: AppKeyTypeConst.RSA_PAIR,
    },
  })
  @Prop({ type: String, enum: AppKeyTypeConst, required: true })
  type: AppKeyTypeConstType

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'timestamp as version',
    },
  })
  @Prop({ type: Number, required: true })
  version: number

  @WalnutAdminDecoratorFieldEnum(() => AppKeyStatusConst, {
    swaggerOptions: {
      title: 'app key status',
      example: AppKeyStatusConst.ACTIVE,
    },
  })
  @Prop({ type: String, enum: AppKeyStatusConst, required: true, default: AppKeyStatusConst.ACTIVE })
  status: AppKeyStatusConstType

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'valid start',
    },
  })
  @Prop({ type: Date, required: true })
  validStart: Date

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'valid end',
    },
  })
  @Prop({ type: Date, default: null })
  validEnd: Date

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'rotate after',
    },
  })
  @Prop({ type: Date, default: null })
  rotateAfter: Date

  @WalnutAdminDecoratorFieldObject(AppKeyMetaType, {
    default: {},
    swaggerOptions: {
      title: 'app key meta',
    },
  })
  @Prop({
    _id: false,
    type: {
      publicKeyPem: String,
      privateKeyPem: String,
      keyB64: String,
      ivB64: String,
      secret: String,
      bits: Number,
      cipher: String,
    },
  })
  meta: InstanceType<typeof AppKeyMetaType>
}

export const AppKeySchema = SchemaFactory.createForClass(AppKeyModel)
