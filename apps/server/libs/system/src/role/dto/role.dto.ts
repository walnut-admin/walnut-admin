import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import { WalnutAdminConstDataScope } from '@walnut-server/const/app/dataScope'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@walnut-server/list'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { SysMenuDTOSafe } from '../../menu/dto/menu.dto'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/role.schema.ts 的 SysRoleModel 改名
// SysRoleDTOBase），装饰器与字段本体零改动；原 role.schema → menu.dto 的反向依赖
// 随合并变为同文件内的基座类引用链
export class SysRoleDTOBase extends WalnutAdminCommonBasicModel {
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
  // 在 DTO 子类用 uuid 校验整体替换，见下方 SysRoleDTO）。基座只承载 Expose 序列化
  // 元数据（Phase 5a 起 mongo id 装饰已随 mongoose 摘除）。
  menus: string[]

  // 数据权限二期批 2：CUSTOM(2) 档位的部门清单（sys_role_dept junction 派生的 uuid 数组）。
  // create 缺省空、update 未给不动 / 给了整组替换（与 menus 同手法）；read 回显。
  @Expose()
  deptIds: string[]

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'role status',
      description:
        'false => users wont retrieve current role menus(permissions)',
    },
  })
  status: boolean

  // 数据权限二期六档（docs/plans/data-scope-phase2-3-plan.md §1.1）：
  // 1=ALL 2=CUSTOM(部门清单) 3=DEPT 4=DEPT_AND_CHILD 5=SELF 6=DEPT_OR_SELF。
  // 值集与实体列/migration CHECK 同源（WalnutAdminConstDataScope）；默认 1（ALL）
  // 与 DDL DEFAULT 对齐 —— 未显式配置的角色保持既有可见面。
  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDataScope, {
    default: WalnutAdminConstDataScope.ALL,
    swaggerOptions: {
      title: 'role data scope',
      description:
        '1=ALL 2=CUSTOM(dept list via sys_role_dept) 3=DEPT 4=DEPT_AND_CHILD 5=SELF 6=DEPT_OR_SELF',
    },
  })
  dataScope: number

  // virtual
  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current role's user count`,
    },
  })
  usersCount: number

  @WalnutAdminDecoratorFieldObject(SysMenuDTOSafe, {
    isArray: true,
    swaggerOptions: {
      title: 'populated menus list',
    },
  })
  menusList: SysMenuDTOSafe[]
}

export class SysRoleDTO extends SysRoleDTOBase {
  constructor(partial?: Partial<SysRoleDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.2）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：menus 原为 ObjectId[]，PG 侧是
  // sys_role_menu 关联表的 menu_id uuid 集合（写入与读出都保持 uuid 数组形态，
  // 响应字段名与 Mongo 版一致）。unique 对齐 Mongo 版数组的业务入参语义
  // （junction 复合 PK 去重，phase2 4.2 勘误不保留 multikey 语义）。
  // 批 7 / L6 评估：menus **不设数量上限** —— 菜单授权是「全量勾选」的常见场景，
  // 上限会随菜单规模增长从「拦脏数据」变成业务限制；deptIds 的 200 只针对部门清单
  // 的量级（部门树远小于菜单全集）。
  @Expose()
  @ApiProperty({
    type: String,
    isArray: true,
    default: [],
    example: ['0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'],
  })
  @WalnutAdminDecoratorValidatorUuid(undefined, true, { unique: true })
  declare menus: string[]

  // CUSTOM 部门清单（sys_role_dept.dept_id uuid 集合）：与 menus 同款重声明 +
  // 数组内去重（复合 PK 兜底，DTO 层先拦输入重复）。
  // 批 7 / L6：数量上限 200（remediation-plan §10 第 3 条拍板）—— 部门树量级内足够，
  // 只拦脏数据/误传，不做业务限制。超限走全局 ValidationPipe 的既有 40099 通道
  // （class-validator 默认消息，仓库校验消息本来就不走 i18n），http 元数据补
  // maxItems 供 openapi 消费（与 demo.dto 的 maxItems/maxSize 同款口径）。
  @Expose()
  @ApiProperty({
    type: String,
    isArray: true,
    default: [],
    maxItems: 200,
    example: ['0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'],
  })
  @WalnutAdminDecoratorValidatorUuid(undefined, true, { unique: true, maxSize: 200 })
  declare deptIds: string[]
}

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysRoleDTOSafe extends SysRoleDTO {
  constructor(partial?: Partial<SysRoleDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

export class SysRoleDTOSafeWithoutMenus extends RealOmitType(SysRoleDTOSafe, [
  'menus',
  'deptIds',
] as const) {
  constructor(partial: Partial<SysRoleDTOSafeWithoutMenus>) {
    super()
    Object.assign(this, partial)
  }
}

// list
// L2 sort 白名单：admin role 列表排 roleName/order/status/createdAt/updatedAt
// （views/system/role 五列全带 sorter，order 为 defaultSortOrder ascend）。
// roleName 有 uq_role_name、createdAt 有 idx_role_created_at DESC；order/status 无
// 索引但 admin 在用 → 保留，见报告建议补索引
export class SysRoleDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysRoleDTOSafe),
  { sortOnlyIn: ['roleName', 'order', 'status', 'createdAt', 'updatedAt'] },
) {}

export class SysRoleDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysRoleDTOSafeWithoutMenus),
) {}

// create
export class SysRoleDTOCreateRequest extends IntersectionType(
  RealPickType(SysRoleDTOSafe, [
    'roleName',
    'description',
    'order',
    'status',
  ] as const),
  RealPartialType(RealPickType(SysRoleDTOSafe, ['menus'] as const)),
  // dataScope 可省略（DDL DEFAULT 1 = ALL）：老客户端/脚本不传时保持既有可见面
  RealPartialType(RealPickType(SysRoleDTOSafe, ['dataScope'] as const)),
  // CUSTOM 部门清单可省略（缺省 = 空清单 → 默认拒绝）；在 create 时直接落 junction
  RealPartialType(RealPickType(SysRoleDTOSafe, ['deptIds'] as const)),
) {}
export class SysRoleDTOCreateResponse extends SysRoleDTOSafe {}

// read
export class SysRoleDTOReadResponse extends SysRoleDTOSafe {}

// update
export class SysRoleDTOUpdateRequest extends IntersectionType(
  RealPickType(SysRoleDTOSafe, [
    'roleName',
    'description',
    'order',
    'status',
  ] as const),
  RealPartialType(RealPickType(SysRoleDTOSafe, ['menus'] as const)),
  // dataScope 可省略（语义：不修改）；显式传 1..6 才触发失效与重算
  RealPartialType(RealPickType(SysRoleDTOSafe, ['dataScope'] as const)),
  // deptIds 可省略（语义：junction 不动）；给了则整组替换并失效该角色成员的 scope 缓存
  RealPartialType(RealPickType(SysRoleDTOSafe, ['deptIds'] as const)),
) {}
export class SysRoleDTOUpdateResponse extends SysRoleDTOSafe {}

// delete
export class SysRoleDTODeleteResponse extends SysRoleDTOSafe {}
