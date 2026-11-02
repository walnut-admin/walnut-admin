import { WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field'
import { SysRoleDTOSafe } from '@walnut-server/system'

/**
 * populate 出参（Phase 5a 起 mongoose virtual 已摘除；role 列表/计数由 PG 通道组装，
 * 键名沿用 `WalnutVirtualName` 的 `roles_list` / `roles_count`）。
 */
export class WalnutAdminVirtualRolesListDTO {
  constructor(partial: Partial<WalnutAdminVirtualRolesListDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldObject(SysRoleDTOSafe, {
    isArray: true,
    swaggerOptions: {
      title: 'virtual roles list',
    },
  })
  roles_list?: SysRoleDTOSafe[] | null
}

export class WalnutAdminVirtualRolesCountDTO {
  constructor(partial: Partial<WalnutAdminVirtualRolesCountDTO>) {
    Object.assign(this, partial)
  }

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'virtual roles count',
    },
  })
  roles_count?: number | null
}
