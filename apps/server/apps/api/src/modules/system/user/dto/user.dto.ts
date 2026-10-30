import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { IWalnutAdminConstRoleMode, WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { WalnutAdminVirtualRolesCountDTO, WalnutAdminVirtualRolesListDTO } from '@/common/model/virtual/role'
import { SysUserGenderConst, SysUserGenderConstType } from '../user.const'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/user.schema.ts 的 SysUserModel 改名
// SysUserDTOBase），装饰器与字段本体零改动
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

// do not use when need to extend
// use `SysUserDTOSafe` below to extend
export class SysUserDTO extends IntersectionType(SysUserDTOBase, WalnutAdminVirtualRolesCountDTO, WalnutAdminVirtualRolesListDTO) {
  constructor(partial?: Partial<SysUserDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.1）：PG 实体是 POJO 无元数据，在 DTO 链头部补声明 ——
  // @Expose 供响应序列化（ClassSerializerInterceptor excludeExtraneousValues 只放行
  // Expose 字段，缺了它响应不带 id）与 RealPickType/RealPartialType 的键枚举；
  // 入参不从这里进（主键只走路由参数的 uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：在 DTO 子类重声明同名字段，class-validator
  // 按 propertyName+type 去重、子类约束整体替换继承的 IsMongoId。roles 原 ObjectId[]
  // → junction 承接的 uuid 数组（数组内去重对齐基座 arrayOptions.unique 的业务语义）
  @Expose()
  @ApiProperty({
    type: String,
    isArray: true,
    default: [],
    example: ['0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'],
  })
  @WalnutAdminDecoratorValidatorUuid(undefined, true, { unique: true })
  declare roles: string[]

  // user's current role id：ObjectId → uuid
  @Expose()
  @ApiProperty({
    type: String,
    nullable: true,
    default: null,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare currentRole: string | null
}

// safe dto without sensitive fields
// （Safe 层曾是「剔除 Mongo `_id`」的派生（B7a/B1 模板）；_id 已随 PG 迁移退役，现仅存名）
export class SysUserDTOSafe extends SysUserDTO {
  constructor(partial?: Partial<SysUserDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list
// L2 sort 白名单：admin user 列表排 status/createdAt/updatedAt（views/system/user
// 三个 preset 列，updatedAt 为 defaultSortOrder descend）。createdAt 有
// idx_user_created_at DESC；status 无索引但 admin 在用 → 保留，见报告建议补索引
export class SysUserDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysUserDTOSafe),
  { sortOnlyIn: ['status', 'createdAt', 'updatedAt'] },
) {}

export class SysUserDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPickType(RealPartialType(SysUserDTOSafe), ['id', 'userName', 'nickName', 'status', 'createdAt', 'updatedAt', 'roles_count'] as const),
) {
  constructor(partial?: Partial<SysUserDTOListResponse>) {
    super()
    Object.assign(this, partial)
  }
}

// create
// 批 2：deptId 可选（admin 用户表单同一棵树选择器；create 直接写 sys_user.dept_id，
// 便于建号即归部门 —— 与 update 的 deptId 分支同口径）
export class SysUserDTOCreateRequest extends IntersectionType(
  RealPickType(SysUserDTOSafe, [
    'userName',
    'status',
    'roles',
  ] as const),
  RealPartialType(RealPickType(SysUserDTOSafe, ['deptId'] as const)),
) {}
export class SysUserDTOCreateResponse extends SysUserDTOSafe {}

// read
export class SysUserDTOReadResponse extends SysUserDTOSafe {}

// update
export class SysUserDTOUpdateRequest extends IntersectionType(
  RealPickType(SysUserDTOSafe, [
    'userName',
    'status',
    'roles',
  ] as const),
  // 部门可省略（语义：不修改）；显式给值（含 null）才触发数据权限缓存失效
  RealPartialType(RealPickType(SysUserDTOSafe, ['deptId'] as const)),
) {}
export class SysUserDTOUpdateResponse extends SysUserDTOSafe {}

// delete
export class SysUserDTODeleteResponse extends SysUserDTOSafe {}
