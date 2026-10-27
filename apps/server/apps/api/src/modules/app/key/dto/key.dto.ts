import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { AppKeyStatusConst, AppKeyStatusConstType, AppKeyTypeConst, AppKeyTypeConstType } from '../key.const'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/key.schema.ts 的 AppKeyModel 改名
// AppKeyDTOBase，AppKeyMetaTypeRaw / AppKeyMetaType 随基座类一并搬入），
// 装饰器与字段本体零改动

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
      example: '-----BEGIN PRIVATE KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAASCQ...\n-----END PRIVATE KEY-----',
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

export class AppKeyDTOBase extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'app key',
      example: 'rsa-req-20250618-001',
      description: 'app key',
    },
  })
  key: string

  @WalnutAdminDecoratorFieldEnum(() => AppKeyTypeConst, {
    swaggerOptions: {
      title: 'app key type',
      example: AppKeyTypeConst.RSA_PAIR,
    },
  })
  type: AppKeyTypeConstType

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'timestamp as version',
    },
  })
  version: number

  @WalnutAdminDecoratorFieldEnum(() => AppKeyStatusConst, {
    swaggerOptions: {
      title: 'app key status',
      example: AppKeyStatusConst.ACTIVE,
    },
  })
  status: AppKeyStatusConstType

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'valid start',
    },
  })
  validStart: Date

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'valid end',
    },
  })
  validEnd: Date

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'rotate after',
    },
  })
  rotateAfter: Date

  @WalnutAdminDecoratorFieldObject(AppKeyMetaType, {
    default: {},
    swaggerOptions: {
      title: 'app key meta',
    },
  })
  meta: InstanceType<typeof AppKeyMetaType>
}

export class AppKeyDTO extends AppKeyDTOBase {
  constructor(partial?: Partial<AppKeyDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.23）：B1 模板 —— @Expose 供响应序列化与
  // RealPickType/RealPartialType 的键枚举；本模块无 list/路由 id 入参
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class AppKeyDTOSafe extends AppKeyDTO {
  constructor(partial?: Partial<AppKeyDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppKeyDTOInit extends RealPickType(AppKeyDTOSafe, ['type'] as const) {
  constructor(partial: Partial<AppKeyDTOInit>) {
    super()
    Object.assign(this, partial)
  }
}
