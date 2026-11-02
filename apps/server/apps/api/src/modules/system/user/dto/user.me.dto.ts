import { IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { SysUserDTOSafe } from './user.dto'

export class SysUserMeDTOUpdateProfileRequest extends IntersectionType(
  RealPickType(SysUserDTOSafe, [
    'userName',
    'nickName',
  ] as const),
  RealPartialType(RealPickType(SysUserDTOSafe, [
    'avatar',
    'description',
    'gender',
  ] as const)),
) {}

/**
 * security-tab2 单种 MFA 的总状态行（`getUserMfaTotalStatus` 的固定形状：
 * 未绑定时 `{ status: false, verified: false }`）—— P3-12 补文档化，wire 零变化。
 */
export class SysUserMeSecurityTab2MethodDTO {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'whether the mfa method is enabled',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'whether the mfa method is verified (bound)',
    },
  })
  verified: boolean
}

/**
 * `GET /system/user/me/security-tab2` 响应 —— totp / webauthn 两种 MFA 的总状态
 * （admin `views/me/tabs/security/tab2` 消费）。P3-12：此前装饰为 `DTO: null`，
 * openapi data 是 null；本 DTO 只补文档层，处理器返回值不变。
 */
export class SysUserMeSecurityTab2ResponseDTO {
  @WalnutAdminDecoratorFieldObject(SysUserMeSecurityTab2MethodDTO, {
    swaggerOptions: {
      title: 'totp status',
    },
  })
  totp: SysUserMeSecurityTab2MethodDTO

  @WalnutAdminDecoratorFieldObject(SysUserMeSecurityTab2MethodDTO, {
    swaggerOptions: {
      title: 'webauthn status',
    },
  })
  webauthn: SysUserMeSecurityTab2MethodDTO
}
