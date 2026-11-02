import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldDate, WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsEnum, IsNotEmpty, IsOptional, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator'
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

  // P0-6（2026-10-28）：私钥永不出 HTTP —— 实体 meta 仍保留 privateKeyPem（服务端
  // 请求解密走实体通道），但 DTO 层不再声明该字段，init/rotate/current 响应统一剔除。

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

/**
 * `GET /app/key/current/:type` 响应 —— key 的公开面（wire 按 type 二选一）：
 * - `RSA_PAIR` → `{ publicKeyPem }`（私钥永不下发，P0-6）
 * - `AES_KEY_URL` → `{ keyB64 }`（前端 URL 掩码的客户端分发密钥）
 *
 * 两个字段都是 optional：swagger 无法按路由参数分叉 schema，这里以并集形态文档化。
 */
export class AppKeyCurrentResponseDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'RSA public key (PEM)',
      description: 'Only present when type is RSA_PAIR. PEM-formatted RSA public key used for request decryption.',
      required: false,
    },
  })
  publicKeyPem?: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Symmetric key (Base64)',
      description: 'Only present when type is AES_KEY_URL. Base64-encoded AES key used by the client for URL masking.',
      required: false,
    },
  })
  keyB64?: string
}

/**
 * P2-6：JWT_AT 由系统启动自举（token 服务持有），不走 HTTP init ——
 * `generateNewKeyByType` 无该分支，旧行为是「恒 20000 且不落行」（假成功）。这里在
 * DTO 校验层直接拒绝（40000 族受控错误 40099），避免客户端把 20000 当成功。
 */
@ValidatorConstraint({ name: 'AppKeyInitTypeNotSystemManaged', async: false })
class AppKeyInitTypeNotSystemManagedConstraint implements ValidatorConstraintInterface {
  validate(value: unknown) {
    return value !== AppKeyTypeConst.JWT_AT
  }

  defaultMessage() {
    return 'JWT_AT is bootstrapped by the system at startup and cannot be initialized through this endpoint'
  }
}

export class AppKeyDTOInit extends RealPickType(AppKeyDTOSafe, ['type'] as const) {
  constructor(partial: Partial<AppKeyDTOInit>) {
    super()
    Object.assign(this, partial)
  }

  // 子类重声明同名字段（demo.dto 模板：class-validator 按 propertyName+type 去重，
  // 子类约束整体替换继承的枚举校验）—— 枚举约束与 JWT_AT 排除一起挂上；swagger /
  // @Expose 元数据沿用基座（不重挂 ApiProperty，避免生成物无谓的 schema 形状变化）
  @IsEnum(AppKeyTypeConst)
  @IsNotEmpty()
  @Validate(AppKeyInitTypeNotSystemManagedConstraint)
  declare type: AppKeyTypeConstType
}
