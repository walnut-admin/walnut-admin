import { ApiProperty } from '@nestjs/swagger'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { Expose, Type } from 'class-transformer'
import { IsOptional, ValidateNested } from 'class-validator'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { SysMenuEntity } from '../entity/menu.entity'
import { SysMenuModel, SysMenuModelMeta } from '../schema/menu.schema'

/**
 * 组装后的菜单行 —— Mongo 版 `.toObject({ flattenObjectIds: true })` 出参的 PG 等价形态
 * （拍平列 + meta 对象；主键 id，不再有 _id）。菜单树 / 路由 / role populated_menusList
 * 的消费侧统一用它标注。
 */
export interface ISysMenuAssembled extends SysMenuEntity {
  meta: SysMenuModelMeta
}

/**
 * B5 迁移（DTO 层）：schema 类仍是元数据基座，本文件额外承担 **meta 拍平的出入参组装** ——
 * - 入参：admin 传 `meta` 对象（19 字段），落库前经 `flattenSysMenuMeta` 拆到 sys_menu 的
 *   19 个拍平列（phase2 4.3 / Q1）。meta 整体缺省时不产生任何列（DB 默认值兜底），与
 *   Mongo 版「meta 缺省 → 子文档默认值」一致；meta **部分**给 出时，缺省字段回填 schema
 *   默认值 —— 对齐 Mongo 版「update 整体替换 meta 子文档 + 默认值回填」的语义。
 * - 出参：`assembleSysMenuMeta` / `assembleSysMenu` 把 19 列组装回 `meta` 对象，admin 侧
 *   菜单管理与路由生成消费的 meta 结构不变；controller 在原 `.toObject()` 的位置调用
 *   `assembleSysMenu` 后再 plainToInstance。
 */

/** meta 19 字段的三元组：[meta 键, 实体拍平列属性名, schema 默认值] */
const SYS_MENU_META_FIELD_MAP = [
  ['order', 'order', null],
  ['ternal', 'ternal', 'none'],
  ['url', 'url', null],
  ['show', 'show', true],
  ['cache', 'cache', false],
  ['status', 'status', true],
  ['affix', 'affix', false],
  ['permission', 'permission', null],
  ['menuActiveName', 'menuActiveName', null],
  ['menuActiveSameTab', 'menuActiveSameTab', false],
  ['badge', 'badge', null],
  ['activeIcon', 'activeIcon', null],
  ['position', 'position', false],
  ['leaveTip', 'leaveTip', false],
  ['maskUrl', 'maskUrl', false],
  ['hijackRefresh', 'hijackRefresh', false],
  ['watermark', 'watermark', null],
  ['transition', 'transition', 'fade'],
  ['cacheKeyStrategy', 'cacheKeyStrategy', null],
] as const

/**
 * @description 出参组装：从拍平列（实体或同形 POJO）组装回 meta 对象。
 * 输入缺键时回填 schema 默认值 —— Mongo 版 meta 子文档必有全量字段（子文档默认值），
 * PG 版靠这里保证 meta 形态逐字段对齐。
 */
export function assembleSysMenuMeta(source: object): SysMenuModelMeta {
  const record = source as Record<string, unknown>
  const meta = {} as Record<string, unknown>

  for (const [metaKey, columnKey, defaultValue] of SYS_MENU_META_FIELD_MAP) {
    const value = record[columnKey]
    meta[metaKey] = value === undefined ? defaultValue : value
  }

  return meta as unknown as SysMenuModelMeta
}

/**
 * @description 出参组装：实体（或列表行 POJO）附回 meta 对象。
 * 对齐 Mongo 版 `.toObject()` 的产出形态（meta 嵌套对象 + 顶层业务字段），供
 * plainToInstance 按名拷贝进 DTO。
 */
export function assembleSysMenu<T extends SysMenuEntity>(entity: T): T & { meta: SysMenuModelMeta } {
  return Object.assign({ ...entity }, { meta: assembleSysMenuMeta(entity as unknown as Record<string, unknown>) })
}

/**
 * @description 入参拆平：把 DTO 上的 `meta` 对象拆成 19 个拍平列属性。
 * meta 整体未给（undefined / null）时原样返回（不产生列 → DB 默认值，同 Mongo 缺省）；
 * 给了则 19 列全量产出（未给的键回填 schema 默认值，同 Mongo 子文档整体替换 + 默认值）。
 */
export function flattenSysMenuMeta<T extends { meta?: Partial<SysMenuModelMeta> | null }>(
  payload: T,
): Omit<T, 'meta'> & Partial<SysMenuEntity> {
  const { meta, ...rest } = payload

  if (meta == null) {
    return rest
  }

  const source = meta as unknown as Record<string, unknown>
  const flattened: Record<string, unknown> = { ...rest }

  for (const [metaKey, columnKey, defaultValue] of SYS_MENU_META_FIELD_MAP) {
    const value = source[metaKey]
    flattened[columnKey] = value === undefined ? defaultValue : value
  }

  return flattened as Omit<T, 'meta'> & Partial<SysMenuEntity>
}

export class SysMenuDTO extends SysMenuModel {
  constructor(partial?: Partial<SysMenuDTO>) {
    super()
    Object.assign(this, partial)
  }

  // PG 主键 id（uuid，phase2 4.3）：B1 模板 —— @Expose 供响应序列化
  // （ClassSerializerInterceptor excludeExtraneousValues 只放行 Expose 字段）与
  // RealPickType/RealPartialType 的键枚举；入参不从这里进（主键只走路由参数的
  // uuid pipe），IsOptional 仅为 list 查询可选过滤
  @Expose()
  @IsOptional()
  @ApiProperty({ type: String, required: false })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  id?: string

  // IsMongoId → IsUUID 模板（B1 确立）：pid 可空（根节点 pid=NULL，phase2 4.3）
  @Expose()
  @ApiProperty({
    type: String,
    default: null,
    nullable: true,
    example: '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c',
  })
  @WalnutAdminDecoratorValidatorUuid({ nullable: true })
  declare pid: string | null
}

// Safe 层剔除 Mongo 的 _id（B1 模板：PG 响应以 id 为唯一标识，_id 在 PG 实体上不存在）
export class SysMenuDTOSafe extends RealOmitType(SysMenuDTO, ['_id'] as const) {
  constructor(partial?: Partial<SysMenuDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}

// menu tree dto
export class SysMenuDTOTree extends RealOmitType(SysMenuDTOSafe, [
  'pid',
  'createdAt',
  'updatedAt',
] as const) {
  constructor(partial: Partial<SysMenuDTOTree>) {
    super()
    Object.assign(this, partial)
  }

  @Expose()
  @Type(() => SysMenuDTOTree)
  @ValidateNested({ each: true })
  children?: SysMenuDTOTree[]
}

class MenuActiveNameItem extends RealPickType(SysMenuDTOTree, ['title', 'name'] as const) {}

export class SysMenuDTOTreeResponse {
  constructor(partial?: Partial<SysMenuDTOTreeResponse>) {
    Object.assign(this, partial)
  }

  @Expose()
  @Type(() => SysMenuDTOTree)
  @ValidateNested({ each: true })
  fullTree: SysMenuDTOTree[]

  @Expose()
  @Type(() => SysMenuDTOTree)
  @ValidateNested({ each: true })
  treeWithoutTypeElement: SysMenuDTOTree[]

  @Expose()
  @Type(() => MenuActiveNameItem)
  @ValidateNested({ each: true })
  menuActiveNamesOptions: { name: string, title: string }[]
}

// list
export class SysMenuDTOListRequest extends CreateWalnutAdminRequestListDTO(
  RealPartialType(SysMenuDTOSafe),
) {}

export class SysMenuDTOListResponse extends CreateWalnutAdminResponseListDTO(
  RealPartialType(SysMenuDTOSafe),
) {}

// create
export class SysMenuDTOCreateRequest extends RealPartialType(SysMenuDTOSafe) {}
export class SysMenuDTOCreateResponse extends SysMenuDTOSafe {}

// read
export class SysMenuDTOReadResponse extends SysMenuDTOSafe {}

// update
export class SysMenuDTOUpdateRequest extends RealPartialType(SysMenuDTOSafe) {}
export class SysMenuDTOUpdateResponse extends SysMenuDTOSafe {}

// delete
export class SysMenuDTODeleteResponse extends SysMenuDTOSafe {}
