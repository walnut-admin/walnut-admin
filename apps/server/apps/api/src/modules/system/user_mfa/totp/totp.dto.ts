import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { RealPickType } from '@walnut-server/utils/dto'
import { SysUserDeviceDTO } from '../../user_device/dto/user_device.dto'
import { SysUserMfaDTOBase } from '../dto/user_mfa.dto'

export class SysUserMfaDTO extends SysUserMfaDTOBase {
  constructor(partial?: Partial<SysUserMfaDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysUserMfaGenerateTotpResponseDTO {
  constructor(partial?: Partial<SysUserMfaGenerateTotpResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'totp id',
    },
  })
  totpId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'totp secret',
    },
  })
  secret: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'qr code',
    },
  })
  qrCode: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'account',
    },
  })
  account: string
}

export class SysUserMfaBindTotpDTO extends RealPickType(SysUserMfaDTOBase, ['name'] as const) {
  @WalnutAdminDecoratorFieldString({
    validateOptions: {
      maxLen: 6,
      minLen: 6,
      numberString: true,
    },
    swaggerOptions: {
      title: 'code',
    },
  })
  code: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'temp totp id',
    },
  })
  tempTotpId: string
}

export class SysUserMfaBindTotpResponseDTO {
  constructor(partial?: Partial<SysUserMfaBindTotpResponseDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldString({
    isArray: true,
    swaggerOptions: {
      title: 'backup codes',
    },
  })
  backupCodes: string[]
}

export class SysUserMfaDeviceVerifyTotpDTO extends RealPickType(SysUserDeviceDTO, ['trusted'] as const) {
  @WalnutAdminDecoratorFieldString({
    validateOptions: {
      maxLen: 6,
      minLen: 6,
      numberString: true,
    },
    swaggerOptions: {
      title: 'code',
    },
  })
  code: string
}
export class SysUserMfaUpdateStatusDTO extends RealPickType(SysUserMfaDTO, ['status'] as const) {
}
