import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPickType } from '@walnut-server/utils/dto'
import { SysUserDeviceDTO } from '../../user_device/dto/user_device.dto'
import { SysUserMfaModel } from '../schema/user_mfa.schema'

export class SysUserMfaWebauthnRegisterOptionsDTO extends RealPickType(SysUserMfaModel, ['name'] as const) {}

export class SysUserMfaWebauthnRegisterResponseDTO {
  constructor(partial: Partial<SysUserMfaWebauthnRegisterResponseDTO>) {
    Object.assign(this, partial)
  }

  // TODO pure type from @simplewebauthn/server cannot be recognized by swagger
  // but i think it's ok to use Object type here cause we do not really care about it
  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: { description: 'WebAuthn Register Options' },
  })
  options: PublicKeyCredentialCreationOptionsJSON

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { description: 'WebAuthn Device Name' },
  })
  deviceName: string
}

export class SysUserMfaWebauthnRegisterVerifyDTO extends RealPickType(SysUserMfaModel, ['name'] as const) {
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

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: { description: 'WebAuthn Authenticate Options' },
  })
  options: PublicKeyCredentialRequestOptionsJSON
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
