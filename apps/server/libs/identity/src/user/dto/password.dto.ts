import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { Expose } from 'class-transformer'

export class ResetPasswordDto {
  // Phase 5a：userId 随 PG 主键体系为 uuid（原 IsMongoId 装饰随 mongoose 摘除）
  @Expose()
  @WalnutAdminDecoratorValidatorUuid()
  userId: string
}

export class UpdatePasswordDto {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'new password' },
  })
  newPassword: string
}
