import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { SysUserDTOSafe } from '@/modules/system/user/dto/user.dto'

/**
 * populate 出参（Phase 5a 起 mongoose virtual 已摘除；键名 `populated_user` 沿用
 * `WalnutDBVirtualName.USER`，回收站 read 直查 PG sys_user 同源表后按此键挂载）。
 */
export class WalnutAdminVirtualUserDTO {
  constructor(partial: Partial<WalnutAdminVirtualUserDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysUserDTOSafe, {
    swaggerOptions: {
      title: 'virtual user',
    },
  })
  populated_user?: SysUserDTOSafe | null
}
