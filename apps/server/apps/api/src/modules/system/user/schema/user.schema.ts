import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { Expose } from 'class-transformer'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

import { SysUserGenderConst, SysUserGenderConstType } from '../user.const'

export class SysUserModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user name',
      description: 'should be unique, used for normal password sign in',
    },
  })
  userName: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user nick name',
      description: 'feel free to change',
    },
  })
  nickName: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'age',
      description: 'should be int and positive',
    },
    validateOptions: { int: true, positive: true },
  })
  age: number

  @WalnutAdminDecoratorFieldEnum(() => SysUserGenderConst, {
    default: SysUserGenderConst.UNDESCRIBED,
    swaggerOptions: {
      title: 'gender',
      description: 'follow GB standard, go internet it',
      example: SysUserGenderConst.UNDESCRIBED,
    },
  })
  gender: SysUserGenderConstType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'avatar',
      description: 'maybe a transform in the future',
    },
    // TODO add oss prefix
    transformOptions: {},
  })
  avatar: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'description',
      description: 'feel free to change',
    },
    validateOptions: {},
  })
  description: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'user status',
      description:
        'false => user cannot sign in anymore, also should ban tokens as well',
    },
  })
  status: boolean

  @Expose()
  // B7a：roles 随 PG 关联表 sys_user_role 放开为 uuid 数组（phase2 4.1；IsMongoId 约束
  // 由 DTO 子类重声明替换为 uuid，B5 role.schema.menus 同款处理）
  roles: string[]

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstRoleMode, {
    default: WalnutAdminConstRoleMode.SWITCH,
    swaggerOptions: {
      title: 'role mode',
      description: `switch => user can switch role freely; combine => user's role is combined by system, along with the permission, user would access all permission in the roles he has`,
      example: WalnutAdminConstRoleMode.SWITCH,
    },
  })
  roleMode: IWalnutAdminConstRoleMode

  @Expose()
  // B7a：随 PG 列 current_role_id（uuid，可空）放开类型注解
  currentRole: string | null

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'MFA setup',
      description:
        'true => user has setup MFA',
    },
  })
  mfaSetup: boolean
}
