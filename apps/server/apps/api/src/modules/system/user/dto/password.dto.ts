import {
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

export class ResetPasswordDto {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { title: 'reset password only need a user id?' },
  })
  userId: string
}

export class UpdatePasswordDto {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'new password' },
  })
  newPassword: string
}
