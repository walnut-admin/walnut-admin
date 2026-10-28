import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPickType } from '@walnut-server/utils/dto'
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

// B7a：管理端按 user 主键定位 —— PG 侧唯一标识是 id（uuid），_id 随 Safe 层剔除。
// id 是这三个 DTO 的唯一定位键，不用 SysUserDTO 上「list 查询可选过滤」的可选声明，
// 在此按必填 uuid 重声明。ApiProperty 纯文档元数据：没有它 swagger 反射出的三个
// ForAdmin DTO 全是空 schema（openapi-typescript 生成 Record<string, never> 废类型）
class AuthOpaqueAdminUserIdDTO {
  @WalnutAdminDecoratorValidatorUuid()
  @ApiProperty({ type: String, format: 'uuid', title: 'user id (uuid)' })
  id: string
}

export class AuthOpaqueStartChangePasswordForAdminDTO extends IntersectionType(AuthOpaqueAdminUserIdDTO, AuthOpaqueStartDTO) {}

export class AuthOpaqueFinishChangePasswordForAdminDTO extends IntersectionType(AuthOpaqueAdminUserIdDTO, AuthOpaqueFinishDTO) {}

export class AuthOpaqueClearPasswordForAdminDTO extends AuthOpaqueAdminUserIdDTO {}
