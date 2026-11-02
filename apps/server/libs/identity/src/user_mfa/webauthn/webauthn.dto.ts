import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { SysUserDeviceDTO } from '../../user_device/dto/user_device.dto'
import { SysUserMfaDTOBase } from '../dto/user_mfa.dto'

export class SysUserMfaWebauthnRegisterOptionsDTO extends RealPickType(SysUserMfaDTOBase, ['name'] as const) {}

// ------------------------------------------------------------------ WebAuthn 选项
//
// `generateRegistrationOptions` / `generateAuthenticationOptions`（@simplewebauthn/server）
// 的返回对象此前只文档化为 `{ [key: string]: unknown }`，admin 无法把它喂进
// @simplewebauthn/browser 的 startRegistration/startAuthentication。以下 DTO 按
// @simplewebauthn/server 的 PublicKeyCredentialCreationOptionsJSON /
// PublicKeyCredentialRequestOptionsJSON 逐字段镜像（字符串枚举也用 inline enum 收窄），
// 生成类型因此与 browser 包的入参结构等价。
//
// 运行时零影响：`options` 字段刻意**不挂 @Type**，普通对象原样透传（挂 @Type 会被
// ClassSerializer 的 excludeExtraneousValues 按 DTO 字段裁剪，改变 wire）。

/** 认证器 transport 联合（@simplewebauthn 的 AuthenticatorTransportFuture）。 */
const WebauthnAuthenticatorTransports = ['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']

/** 认证器提示联合（@simplewebauthn 的 PublicKeyCredentialHint）。 */
const WebauthnPublicKeyCredentialHints = ['hybrid', 'security-key', 'client-device']

const WebauthnUserVerificationRequirements = ['discouraged', 'preferred', 'required']

export class SysUserMfaWebauthnRpEntityDTO {
  @ApiProperty({ type: String, description: 'Relying Party name' })
  @Expose()
  name: string

  @ApiProperty({ type: String, description: 'Relying Party id (domain)', required: false })
  @Expose()
  id?: string
}

export class SysUserMfaWebauthnUserEntityDTO {
  @ApiProperty({ type: String, description: 'user handle (base64url)' })
  @Expose()
  id: string

  @ApiProperty({ type: String, description: 'user name' })
  @Expose()
  name: string

  @ApiProperty({ type: String, description: 'user display name' })
  @Expose()
  displayName: string
}

export class SysUserMfaWebauthnPubKeyCredParamDTO {
  @ApiProperty({ type: Number, description: 'COSE algorithm identifier' })
  @Expose()
  alg: number

  @ApiProperty({ type: String, enum: ['public-key'], description: 'credential type' })
  @Expose()
  type: 'public-key'
}

export class SysUserMfaWebauthnCredentialDescriptorDTO {
  @ApiProperty({ type: String, description: 'credential id (base64url)' })
  @Expose()
  id: string

  @ApiProperty({ type: String, enum: ['public-key'], description: 'credential type' })
  @Expose()
  type: 'public-key'

  @ApiProperty({
    type: [String],
    enum: WebauthnAuthenticatorTransports,
    description: 'authenticator transports',
    required: false,
  })
  @Expose()
  transports?: string[]
}

export class SysUserMfaWebauthnAuthenticatorSelectionDTO {
  @ApiProperty({
    type: String,
    enum: ['cross-platform', 'platform'],
    description: 'authenticator attachment',
    required: false,
  })
  @Expose()
  authenticatorAttachment?: string

  @ApiProperty({ type: Boolean, description: 'require resident key', required: false })
  @Expose()
  requireResidentKey?: boolean

  @ApiProperty({
    type: String,
    enum: WebauthnUserVerificationRequirements,
    description: 'resident key requirement',
    required: false,
  })
  @Expose()
  residentKey?: string

  @ApiProperty({
    type: String,
    enum: WebauthnUserVerificationRequirements,
    description: 'user verification requirement',
    required: false,
  })
  @Expose()
  userVerification?: string
}

export class SysUserMfaWebauthnExtensionInputsDTO {
  @ApiProperty({ type: String, description: 'appid extension input', required: false })
  @Expose()
  appid?: string

  @ApiProperty({ type: Boolean, description: 'credProps extension input', required: false })
  @Expose()
  credProps?: boolean

  @ApiProperty({ type: Boolean, description: 'hmacCreateSecret extension input', required: false })
  @Expose()
  hmacCreateSecret?: boolean

  @ApiProperty({ type: Boolean, description: 'minPinLength extension input', required: false })
  @Expose()
  minPinLength?: boolean
}

/** `POST /system/user/mfa/webauthn/register/options` 的 `options` 形态。 */
export class SysUserMfaWebauthnCreationOptionsDTO {
  @ApiProperty({ type: String, description: 'cryptographic challenge (base64url)' })
  @Expose()
  challenge: string

  @ApiProperty({ type: () => SysUserMfaWebauthnRpEntityDTO, description: 'relying party entity' })
  @Expose()
  rp: SysUserMfaWebauthnRpEntityDTO

  @ApiProperty({ type: () => SysUserMfaWebauthnUserEntityDTO, description: 'user entity' })
  @Expose()
  user: SysUserMfaWebauthnUserEntityDTO

  @ApiProperty({ type: () => [SysUserMfaWebauthnPubKeyCredParamDTO], description: 'acceptable public key algorithms' })
  @Expose()
  pubKeyCredParams: SysUserMfaWebauthnPubKeyCredParamDTO[]

  @ApiProperty({ type: Number, description: 'timeout in ms', required: false })
  @Expose()
  timeout?: number

  @ApiProperty({
    type: String,
    enum: ['direct', 'enterprise', 'indirect', 'none'],
    description: 'attestation conveyance preference',
    required: false,
  })
  @Expose()
  attestation?: string

  @ApiProperty({ type: () => [SysUserMfaWebauthnCredentialDescriptorDTO], description: 'credentials already registered by the user', required: false })
  @Expose()
  excludeCredentials?: SysUserMfaWebauthnCredentialDescriptorDTO[]

  @ApiProperty({ type: () => SysUserMfaWebauthnAuthenticatorSelectionDTO, description: 'authenticator selection criteria', required: false })
  @Expose()
  authenticatorSelection?: SysUserMfaWebauthnAuthenticatorSelectionDTO

  @ApiProperty({ type: () => SysUserMfaWebauthnExtensionInputsDTO, description: 'client extension inputs', required: false })
  @Expose()
  extensions?: SysUserMfaWebauthnExtensionInputsDTO

  @ApiProperty({
    type: [String],
    enum: WebauthnPublicKeyCredentialHints,
    description: 'authenticator hints',
    required: false,
  })
  @Expose()
  hints?: string[]
}

/** `POST /system/user/mfa/webauthn/authenticate/options` 的 `options` 形态。 */
export class SysUserMfaWebauthnRequestOptionsDTO {
  @ApiProperty({ type: String, description: 'cryptographic challenge (base64url)' })
  @Expose()
  challenge: string

  @ApiProperty({ type: Number, description: 'timeout in ms', required: false })
  @Expose()
  timeout?: number

  @ApiProperty({ type: String, description: 'relying party id (domain)', required: false })
  @Expose()
  rpId?: string

  @ApiProperty({ type: () => [SysUserMfaWebauthnCredentialDescriptorDTO], description: 'credentials the client may use', required: false })
  @Expose()
  allowCredentials?: SysUserMfaWebauthnCredentialDescriptorDTO[]

  @ApiProperty({
    type: String,
    enum: WebauthnUserVerificationRequirements,
    description: 'user verification requirement',
    required: false,
  })
  @Expose()
  userVerification?: string

  @ApiProperty({ type: () => SysUserMfaWebauthnExtensionInputsDTO, description: 'client extension inputs', required: false })
  @Expose()
  extensions?: SysUserMfaWebauthnExtensionInputsDTO

  @ApiProperty({
    type: [String],
    enum: WebauthnPublicKeyCredentialHints,
    description: 'authenticator hints',
    required: false,
  })
  @Expose()
  hints?: string[]
}

export class SysUserMfaWebauthnRegisterResponseDTO {
  constructor(partial: Partial<SysUserMfaWebauthnRegisterResponseDTO>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: () => SysUserMfaWebauthnCreationOptionsDTO, description: 'WebAuthn Register Options' })
  @Expose()
  options: SysUserMfaWebauthnCreationOptionsDTO

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'WebAuthn Device Name' },
  })
  deviceName: string
}

export class SysUserMfaWebauthnRegisterVerifyDTO extends RealPickType(SysUserMfaDTOBase, ['name'] as const) {
  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: { description: 'WebAuthn 注册响应' },
    validateOptions: {
      any: true,
    },
  })
  response: RegistrationResponseJSON
}

export class SysUserMfaWebauthnAuthenticateOptionsDTO {
  constructor(partial: Partial<SysUserMfaWebauthnAuthenticateOptionsDTO>) {
    Object.assign(this, partial)
  }

  @ApiProperty({ type: () => SysUserMfaWebauthnRequestOptionsDTO, description: 'WebAuthn Authenticate Options' })
  @Expose()
  options: SysUserMfaWebauthnRequestOptionsDTO
}

export class SysUserMfaWebauthnAuthenticateVerifyDTO extends RealPickType(SysUserDeviceDTO, ['trusted'] as const) {
  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: { description: 'WebAuthn 认证响应' },
    validateOptions: {
      any: true,
    },
  })
  response: AuthenticationResponseJSON
}
