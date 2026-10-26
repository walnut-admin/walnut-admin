import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { Expose } from 'class-transformer'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysMenuDTOSafe } from '../../menu/dto/menu.dto'

export class SysRoleModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'role name',
      description: 'unique string',
    },
  })
  roleName: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'role description',
      description: 'short describe',
    },
  })
  description: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'role order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  order: number

  @Expose()
  // B5：menus 随 PG 关联表 sys_role_menu 放开为 uuid 数组（phase2 4.2；IsMongoId 约束
  // 在 DTO 子类用 uuid 校验整体替换，见 dto/role.dto.ts）。schema 只承载 Expose 序列化
  // 元数据（Phase 5a 起 mongo id 装饰已随 mongoose 摘除）。
  menus: string[]

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'role status',
      description:
        'false => users wont retrieve current role menus(permissions)',
    },
  })
  status: boolean

  // virtual
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current role's user count`,
    },
  })
  populated_usersCount: number

  @WalnutAdminDecoratorFieldObject(SysMenuDTOSafe, {
    isArray: true,
    swaggerOptions: {
      title: 'populated menus list',
    },
  })
  populated_menusList: SysMenuDTOSafe[]
}
