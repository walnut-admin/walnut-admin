import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { Expose } from 'class-transformer'
import { WalnutAdminCommonBasicModel } from '../../shared/base.model'
import { SysUserGenderConst, SysUserGenderConstType } from '../user.const'

/**
 * user 行的 DTO 字段基座（libs 解耦批 6 随身份内核下沉）。
 *
 * 为什么只有基座：wire 层的 `SysUserDTO` / `SysUserDTOSafe` 组合了 role 读模型
 * （`WalnutAdminVirtualRolesListDTO → SysRoleDTOSafe → SysMenuDTOSafe` 链）。那条链
 * 是 app 的 role/menu 管理模块的 DTO 真源，下沉内核要么把 menu DTO 一起拖进来，
 * 要么让 swagger 的 `$ref` 退化成字符串、schema 装配顺序漂移（openapi 会出 diff）。
 * 因此：内核拥有「身份数据字段」，app 的组合根拥有「wire 响应面」——
 * `apps/api/src/modules/system/user/dto/user.dto.ts` 的 `SysUserDTO` 继续以本基座
 * 为父类（class 名与 schema 名不变，openapi 零 diff）。
 *
 * 批 4 结构重构的历史注释保留：schema/ 并入 dto/，装饰器与字段本体零改动。
 */
export class SysUserDTOBase extends WalnutAdminCommonBasicModel {
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
  // 由 DTO 子类重声明替换为 uuid，B5 role menus 同款处理）
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

  // 所属部门（数据权限二期批 1）：写 sys_user.dept_id，DEPT/DEPT_AND_CHILD 的解析输入。
  // 批 2 起 create / update 都可选提供（admin 用户表单的部门树选择器）。
  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true },
    // 数据权限批 4 / B1：string 字段的 booleanString Transform 会把「未提交」物化成
    // null（自有属性），使 update 无法区分「没给 deptId」与「显式清空部门」。这里
    // 关掉入参方向的 transform —— 未提交保持属性缺失/undefined，显式 null 仍原样保留。
    transformOptions: { req: { booleanString: false } },
    swaggerOptions: {
      title: 'dept id',
      description: 'owning dept for department-scoped data permissions; null => no dept',
      nullable: true,
      example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
    },
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  deptId: string | null
}
