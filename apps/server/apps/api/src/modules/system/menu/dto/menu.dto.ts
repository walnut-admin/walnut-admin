import type { IWalnutAdminMenuMeta } from '@walnut/contract/menu'
import { ApiProperty } from '@nestjs/swagger'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorValidatorUuid } from '@walnut-server/decorators/validator'
import { RealOmitType, RealPartialType, RealPickType } from '@walnut-server/utils/dto'
import { CacheKeyStrategy, MenuTernal, MenuType } from '@walnut/contract/menu'
import { Expose, Type } from 'class-transformer'
import { IsOptional, ValidateNested } from 'class-validator'
import { Recordable } from 'easy-fns-ts'
import {
  CreateWalnutAdminRequestListDTO,
  CreateWalnutAdminResponseListDTO,
} from '@/common/dto/list.dto'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysMenuEntity } from '../entity/menu.entity'

// 批 4 结构重构：schema/ 并入 dto/（原 schema/menu.schema.ts 的 SysMenuModel /
// SysMenuModelMeta 改名 SysMenuDTOBase / SysMenuMetaDTOBase），装饰器与字段本体零改动。
// meta 的**形状**是 admin 侧也在消费的 wire 契约 —— 基座类 implements @walnut/contract
// 的纯 interface `IWalnutAdminMenuMeta`（contract 禁止拖 class-validator 进前端包），
// 跨模块类型消费从 contract 取形、装饰器类留在本文件。

export class SysMenuMetaDTOBase implements IWalnutAdminMenuMeta {
  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'menu order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  order: number

  @WalnutAdminDecoratorFieldEnum(() => MenuTernal, {
    default: MenuTernal.NONE,
    swaggerOptions: {
      title: 'menu ternal type',
      description:
        'internal => no jump, iframe inside page. external => jump url, need to confirm',
      example: MenuTernal.NONE,
    },
  })
  ternal: typeof MenuTernal[keyof typeof MenuTernal]

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'ternal url',
      description: 'should be a full and real url',
    },
    validateOptions: {
      url: true,
    },
  })
  url: string

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'menu show status',
      description:
        'false => will be filtered in front end. set this false when need to hide a page like detail which not necessary in menu and tabs',
    },
  })
  show: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'menu cache status',
      description: 'true => will be cached in keep-alive',
    },
  })
  cache: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'menu status',
      description: 'false => will not be retrieved from database',
    },
  })
  status: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'tab status',
      description: 'true => tab will be affixed in left/right',
    },
  })
  affix: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'permission string',
      description: 'permission string, mostly like *:*:*',
    },
  })
  permission: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu active name',
      description:
        'used for show=false page, tell front end to active which menu when show=false page is opened',
    },
  })
  menuActiveName: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'menu active same tab',
      description:
        'mostly used with `menuActiveName`, true => no new tab for show=false page',
    },
  })
  menuActiveSameTab: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu badge',
      description:
        'menu badge, normally red dot or a number or a ???character',
    },
  })
  badge: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'menu active icon',
      description:
        'show different icon when menu is activited, icon show follow iconify and unocss rules',
    },
  })
  activeIcon: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'page scroll position status',
      description: 'true => remember scroll postion for the user',
    },
  })
  position: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'page leave tip',
      description:
        'true => will show a leave confirm message modal to make sure ready to leave current page',
    },
  })
  leaveTip: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'browser url masking, including path/params/query',
    },
  })
  maskUrl: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'hijack refresh token',
      description:
        'true => will hijack refresh token in front end',
    },
  })
  hijackRefresh: boolean

  @WalnutAdminDecoratorFieldObject(Object, {
    validateOptions: {
      any: true,
    },
  })
  watermark: Recordable

  @WalnutAdminDecoratorFieldString({
    default: 'fade',
    swaggerOptions: {
      title: 'transition name',
      description:
        'used for vue transition name',
    },
  })
  transition: string

  @WalnutAdminDecoratorFieldEnum(() => CacheKeyStrategy, {
    default: null,
    swaggerOptions: {
      title: 'cache key strategy',
      description:
        'name => use menu name as cache key. path => use menu path as cache key',
      example: CacheKeyStrategy.NAME,
    },
  })
  cacheKeyStrategy: typeof CacheKeyStrategy[keyof typeof CacheKeyStrategy]
}

export class SysMenuDTOBase extends WalnutAdminCommonBasicModel {
  @Expose()
  // B5：pid 随 PG 列型放开为可空 uuid（根节点 pid=NULL，phase2 4.3；IsMongoId 约束在
  // DTO 子类用 uuid 校验整体替换，见下方 SysMenuDTO）
  pid: string | null

  @WalnutAdminDecoratorFieldEnum(() => MenuType, {
    default: MenuType.CATALOG,
    swaggerOptions: {
      title: 'basic menu type, mostly used in front end',
      description:
        'catalog => like folder, can only have child nodes. menu => refer to route. element => front end element permission',
      example: MenuType.CATALOG,
    },
  })
  type: typeof MenuType[keyof typeof MenuType]

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route path',
      description: 'used for vue router path',
    },
  })
  path: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route name',
      description:
        'used for vue router name, should be unique, also used for keep-alive flags',
    },
  })
  name: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route component file path',
      description: 'used for vue router to find target file path',
    },
  })
  component: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route title',
      description: 'used for route page title, mostly is i18n format',
    },
  })
  title: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'route icon',
      description: 'used for route icon, shown in menus and tabs',
    },
  })
  icon: string

  @WalnutAdminDecoratorFieldObject(RealPartialType(SysMenuMetaDTOBase), {
    swaggerOptions: {
      title: 'menu meta data, lots of fields',
    },
  })
  meta: SysMenuMetaDTOBase
}

/**
 * 组装后的菜单行 —— Mongo 版 `.toObject({ flattenObjectIds: true })` 出参的 PG 等价形态
 * （拍平列 + meta 对象；主键 id，不再有 _id）。菜单树 / 路由 / role populated_menusList
 * 的消费侧统一用它标注。
 */
export interface ISysMenuAssembled extends SysMenuEntity {
  meta: SysMenuMetaDTOBase
}

/**
 * B5 迁移（DTO 层）：基座类是元数据基座，本文件额外承担 **meta 拍平的出入参组装** ——
 * - 入参：admin 传 `meta` 对象（19 字段），落库前经 `flattenSysMenuMeta` 拆到 sys_menu 的
 *   19 个拍平列（phase2 4.3 / Q1）。meta 整体缺省时不产生任何列（DB 默认值兜底），与
 *   Mongo 版「meta 缺省 → 子文档默认值」一致；meta **部分**给 出时，缺省字段回填默认值
 *   —— 对齐 Mongo 版「update 整体替换 meta 子文档 + 默认值回填」的语义。
 * - 出参：`assembleSysMenuMeta` / `assembleSysMenu` 把 19 列组装回 `meta` 对象，admin 侧
 *   菜单管理与路由生成消费的 meta 结构不变；controller 在原 `.toObject()` 的位置调用
 *   `assembleSysMenu` 后再 plainToInstance。
 */

/** meta 19 字段的三元组：[meta 键, 实体拍平列属性名, 默认值] */
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
 * 输入缺键时回填默认值 —— Mongo 版 meta 子文档必有全量字段（子文档默认值），
 * PG 版靠这里保证 meta 形态逐字段对齐。
 */
export function assembleSysMenuMeta(source: object): SysMenuMetaDTOBase {
  const record = source as Record<string, unknown>
  const meta = {} as Record<string, unknown>

  for (const [metaKey, columnKey, defaultValue] of SYS_MENU_META_FIELD_MAP) {
    const value = record[columnKey]
    meta[metaKey] = value === undefined ? defaultValue : value
  }

  return meta as unknown as SysMenuMetaDTOBase
}

/**
 * @description 出参组装：实体（或列表行 POJO）附回 meta 对象。
 * 对齐 Mongo 版 `.toObject()` 的产出形态（meta 嵌套对象 + 顶层业务字段），供
 * plainToInstance 按名拷贝进 DTO。
 */
export function assembleSysMenu<T extends SysMenuEntity>(entity: T): T & { meta: SysMenuMetaDTOBase } {
  return Object.assign({ ...entity }, { meta: assembleSysMenuMeta(entity as unknown as Record<string, unknown>) })
}

/**
 * @description 入参拆平：把 DTO 上的 `meta` 对象拆成 19 个拍平列属性。
 * meta 整体未给（undefined / null）时原样返回（不产生列 → DB 默认值，同 Mongo 缺省）；
 * 给了则 19 列全量产出（未给的键回填默认值，同 Mongo 子文档整体替换 + 默认值）。
 * 「未给」的判据是 `== null` 而非仅 `=== undefined`：HTTP 入参经 ValidationPipe 的
 * plainToInstance 深度实例化（meta 挂 @Type），部分 meta 的未给键会以**显式 null** 落在
 * 实例上（C 段 menu.api-spec 抓出的迁移回归 —— 只判 undefined 时 is_show 等非空列收到
 * NULL，INSERT 直接撞 NOT NULL 约束；Mongo 版子文档缺键即默认值，语义对齐）。
 */
export function flattenSysMenuMeta<T extends { meta?: Partial<SysMenuMetaDTOBase> | null }>(
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
    // ?? 即「null/undefined 都算未给」—— HTTP 入参经 ValidationPipe 深度实例化后，
    // 部分 meta 的未给键是显式 null（见方法注释的迁移回归记录）
    flattened[columnKey] = value ?? defaultValue
  }

  return flattened as Omit<T, 'meta'> & Partial<SysMenuEntity>
}

export class SysMenuDTO extends SysMenuDTOBase {
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

// Safe 层曾是「剔除 Mongo `_id`」的派生（B1 模板）；_id 已随 PG 迁移退役，现仅存名
export class SysMenuDTOSafe extends SysMenuDTO {
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
