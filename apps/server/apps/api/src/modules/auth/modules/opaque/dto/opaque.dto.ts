import { IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'
import { RealPickType } from '@walnut/utils/dto'
import { ValueOf } from 'easy-fns-ts'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'

class AuthOpaqueStartDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'start',
    },
  })
  start: string
}

class AuthOpaqueFinishDTO {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'finish',
    },
  })
  finish: string
}

export class AuthOpaqueStartSignInDTO extends IntersectionType(RealPickType(SysUserDTOSafe, ['userName']), AuthOpaqueStartDTO) {}

const signInFinishClientError = {
  passwordError: 'passwordError',
  serverStaticKeyMismatch: 'serverStaticKeyMismatch',
} as const

type ISignInFinishClientError = ValueOf<typeof signInFinishClientError>
export class AuthOpaqueFinishSignInDTO extends IntersectionType(RealPickType(SysUserDTOSafe, ['userName']), AuthOpaqueFinishDTO) {}

export class AuthOpaqueClientErrorDTO extends RealPickType(SysUserDTOSafe, ['userName']) {
  @WalnutAdminDecoratorFieldEnum(() => signInFinishClientError, {
    swaggerOptions: {
      title: 'clientError',
    },
  })
  clientError: ISignInFinishClientError
}

export class AuthOpaqueStartSignUpDTO extends AuthOpaqueStartDTO {}

export class AuthOpaqueFinishSignUpDTO extends AuthOpaqueFinishDTO {}

export class AuthOpaqueStartChangePasswordDTO extends AuthOpaqueStartDTO {}

export class AuthOpaqueFinishChangePasswordDTO extends AuthOpaqueFinishDTO {}

export class AuthOpaqueStartChangePasswordForAdminDTO extends IntersectionType(RealPickType(SysUserDTOSafe, ['_id']), AuthOpaqueStartDTO) {}

export class AuthOpaqueFinishChangePasswordForAdminDTO extends IntersectionType(RealPickType(SysUserDTOSafe, ['_id']), AuthOpaqueFinishDTO) {}

export class AuthOpaqueClearPasswordForAdminDTO extends RealPickType(SysUserDTOSafe, ['_id'] as const) {}
