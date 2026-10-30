import { ApiProperty, IntersectionType } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose, Type } from 'class-transformer'
import { IsOptional, ValidateNested } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { ISysDeptStatus, SysDeptStatusConst } from '../dept.const'

/**
 * 部门 DTO 基座 ↔ `SysDeptEntity` 逐字段对应（dept/post/employee 三模块是新增表，
 * 无 Mongo 历史形态要兼容，字段名与实体属性名同形）。
 *
 * 可空字段的判据：`default: null`（swagger 展示）+ `validateOptions.nullable`（校验跳过）；
 * 必填字段两者都不给 —— 必填性只有这一个真源（server AGENTS.md「DTO 两条」）。
 */
export class SysDeptDTOBase extends WalnutAdminCommonBasicModel {
  // 根部门 parentId=null；自引用 FK RESTRICT 在 migration
  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true },
    swaggerOptions: {
      title: 'parent dept id',
      description: 'null => root dept',
      nullable: true,
      example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
    },
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  parentId: string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dept code',
      description: 'unique business key',
    },
    validateOptions: { maxLen: 64 },
  })
  deptCode: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dept name',
    },
  })
  deptName: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true },
    swaggerOptions: { title: 'dept leader', nullable: true },
  })
  leader: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true, maxLen: 32 },
    swaggerOptions: { title: 'contact phone', nullable: true },
  })
  phone: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    validateOptions: { nullable: true, email: true },
    swaggerOptions: { title: 'contact email', nullable: true },
  })
  email: string | null

  @WalnutAdminDecoratorFieldNumber({
    default: 0,
    swaggerOptions: {
      title: 'sort order',
      description: 'sibling order inside the same parent, should be int',
    },
    validateOptions: { int: true },
  })
  sortOrder: number

  @WalnutAdminDecoratorFieldEnum(() => SysDeptStatusConst, {
    default: SysDeptStatusConst.ENABLED,
    swaggerOptions: {
      title: 'dept status',
      description: 'disabled => not selectable in new assignments, existing rows stay',
      example: SysDeptStatusConst.ENABLED,
    },
  })
  status: ISysDeptStatus
}

export class SysDeptDTO extends SysDeptDTOBase {
  constructor(partial?: Partial<SysDeptDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid）：B1 模板 —— @Expose 供响应序列化与 RealPickType 键枚举；
  // 入参不从这里进（主键只走路由参数的 uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string
}

export class SysDeptDTOSafe extends SysDeptDTO {
  constructor(partial?: Partial<SysDeptDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// list：admin 部门树表格排序按 sortOrder / createdAt
export class SysDeptDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysDeptDTOSafe),
  { sortOnlyIn: ['deptCode', 'deptName', 'sortOrder', 'status', 'createdAt', 'updatedAt'] },
) {}

export class SysDeptDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysDeptDTOSafe),
) {}

// create：deptCode / deptName / status 必填，其余可选（sortOrder / 联系方式 / 父节点）
export class SysDeptDTOCreateRequest extends IntersectionType(
  RealPickType(SysDeptDTOSafe, ['deptCode', 'deptName', 'status'] as const),
  RealPartialType(RealPickType(SysDeptDTOSafe, [
    'parentId',
    'leader',
    'phone',
    'email',
    'sortOrder',
  ] as const)),
) {}
export class SysDeptDTOCreateResponse extends SysDeptDTOSafe {}

// read
export class SysDeptDTOReadResponse extends SysDeptDTOSafe {}

// update：与 create 同形 —— **PUT 是整体替换**（必填核仍必填；可选字段缺省即清空，
// 如不给 parentId = 提升为根部门）。与 lang / dictType / role 的 update 口径一致；
// 前端编辑表单始终回填全量字段。主键只走路由参数。
export class SysDeptDTOUpdateRequest extends IntersectionType(
  RealPickType(SysDeptDTOSafe, ['deptCode', 'deptName', 'status'] as const),
  RealPartialType(RealPickType(SysDeptDTOSafe, [
    'parentId',
    'leader',
    'phone',
    'email',
    'sortOrder',
  ] as const)),
) {}
export class SysDeptDTOUpdateResponse extends SysDeptDTOSafe {}

// delete
export class SysDeptDTODeleteResponse extends SysDeptDTOSafe {}

/**
 * 部门树节点 —— 树端点 / 子树端点的出参形态（`children` 是组装字段，实体无列；
 * 它是派生 DTO、不是 `*DTOBase`，不进 dto↔entity 漂移守卫的基座清单）。
 */
export class SysDeptDTOTree extends RealOmitType(SysDeptDTOSafe, [
  'parentId',
  'createdAt',
  'updatedAt',
] as const) {
  constructor(partial: Partial<SysDeptDTOTree>) {
    super()
    Object.assign(this, partial)
  }

  // 自引用 children 只有 class-transformer 元数据时 swagger 反射不到；
  // 补 ApiProperty（纯文档元数据）让递归结构进 openapi.json
  @Expose()
  @Type(() => SysDeptDTOTree)
  @ValidateNested({ each: true })
  @ApiProperty({ type: () => [SysDeptDTOTree], required: false })
  children?: SysDeptDTOTree[]
}
