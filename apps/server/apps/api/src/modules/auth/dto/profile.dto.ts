import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'

export class AuthProfileResponseDto {
  constructor(partial: Partial<AuthProfileResponseDto>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysUserDTOSafe, {
    swaggerOptions: {
      title: 'user lock route',
    },
  })
  user: SysUserDTOSafe
}
