import { WalnutAdminDecoratorFieldBoolean } from '@walnut-server/decorators/field'

export class AuthMfaVerifyDTO {
  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      description: 'is trusted device',
    },
  })
  trusted: boolean
}

// 批 6：AuthMfaStatusDTO 随 MFA 状态读腿下沉 libs/identity（user_mfa 的 shared service
// 返回该形状）；本文件 re-export 保持 auth 侧 import 面与 schema 名不变。
export { AuthMfaStatusDTO } from '@walnut-server/identity'
