import type { ClassConstructor } from 'class-transformer'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WalnutDBModelName } from '@walnut-server/db'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { getMetadataArgsStorage } from 'typeorm'
import { describe, expect, it } from 'vitest'
import { AppDemoDTOBase } from '@/modules/app/demo/dto/demo.dto'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { AppErrorEntity } from '@/modules/app/error/entity/error.entity'

// ─── 被守卫的 DTO 基座 ↔ 实体清单（全部模块逐一显式 import，映射见下方 DTO_ENTITY_CASES）───

import { AppErrorDTOBase } from '@/modules/app/error/error.dto'
import { AppKeyDTOBase } from '@/modules/app/key/dto/key.dto'
import { AppKeyEntity } from '@/modules/app/key/entity/key.entity'
import { AppMonitorUserDTOBase } from '@/modules/app/monitor/user/dto/user.dto'
import { AppMonitorUserEntity } from '@/modules/app/monitor/user/entity/monitor-user.entity'
import { AppSettingDTOBase } from '@/modules/app/setting/dto/setting.dto'
import { AppSettingEntity } from '@/modules/app/setting/entity/setting.entity'
import { SharedAreaDTOBase } from '@/modules/shared/area/dto/area.dto'
import { SharedAreaEntity } from '@/modules/shared/area/entity/area.entity'
import { SysDeletedDTOBase } from '@/modules/system/deleted/dto/deleted.dto'
import { SysDeletedEntity } from '@/modules/system/deleted/entity/deleted.entity'
import { WALNUT_PG_RECOVERABLE_COLLECTIONS } from '@/modules/system/deleted/repo/recover-registry'
import { SysDeviceDTOBase } from '@/modules/system/device/dto/device.dto'
import { SysDeviceEntity } from '@/modules/system/device/entity/device.entity'
import { SysDictDataDTOBase } from '@/modules/system/dict/dictData/dto/dictData.dto'
import { SysDictDataEntity } from '@/modules/system/dict/dictData/entity/dict-data.entity'
import { SysDictTypeDTOBase } from '@/modules/system/dict/dictType/dto/dictType.dto'
import { SysDictTypeEntity } from '@/modules/system/dict/dictType/entity/dict-type.entity'
import { SysLangDTOBase } from '@/modules/system/lang/dto/lang.dto'
import { SysLangEntity } from '@/modules/system/lang/entity/lang.entity'
import { SysLocaleDTOBase } from '@/modules/system/locale/dto/locale.dto'
import { SysLocaleEntity } from '@/modules/system/locale/entity/locale.entity'
import { SysLogAuthDTOBase } from '@/modules/system/logs/auth/dto/log.auth.dto'
import { SysLogAuthEntity } from '@/modules/system/logs/auth/entity/log-auth.entity'
import { SysLogOperateDTOBase } from '@/modules/system/logs/operate/dto/log.operate.dto'
import { SysLogOperateEntity } from '@/modules/system/logs/operate/entity/log-operate.entity'
import {
  assembleSysMenuMeta,
  flattenSysMenuMeta,
  SYS_MENU_META_FIELD_MAP,
  SysMenuDTOBase,
  SysMenuDTOCreateRequest,
  SysMenuDTOUpdateRequest,
  SysMenuMetaDTOBase,
} from '@/modules/system/menu/dto/menu.dto'
import { SysMenuEntity } from '@/modules/system/menu/entity/menu.entity'
import { SysRoleDTOBase } from '@/modules/system/role/dto/role.dto'
import { SysRoleEntity } from '@/modules/system/role/entity/role.entity'
import { SysUserDTOBase } from '@/modules/system/user/dto/user.dto'
import { SysUserEntity } from '@/modules/system/user/entity/user.entity'
import { SysUserDeviceDTOBase } from '@/modules/system/user_device/dto/user_device.dto'
import { SysUserDeviceEntity } from '@/modules/system/user_device/entity/user-device.entity'
import { SysUserIdentityDTOBase } from '@/modules/system/user_identity/dto/user_identity.dto'
import { SysUserIdentityEntity } from '@/modules/system/user_identity/entity/user-identity.entity'
import { SysUserLockDTOBase } from '@/modules/system/user_lock/dto/user_lock.dto'
import { SysUserLockEntity } from '@/modules/system/user_lock/entity/user-lock.entity'
import { SysUserMfaDTOBase } from '@/modules/system/user_mfa/dto/user_mfa.dto'
import { SysUserMfaEntity } from '@/modules/system/user_mfa/entity/user-mfa.entity'
import { SysUserOAuthDTOBase } from '@/modules/system/user_oauth/dto/user_oauth.dto'
import { SysUserOauthEntity } from '@/modules/system/user_oauth/entity/user-oauth.entity'
import { SysUserPreferenceDTOBase } from '@/modules/system/user_preference/dto/user_preference.dto'
import { SysUserPreferenceEntity } from '@/modules/system/user_preference/entity/user-preference.entity'

/**
 * DTO ↔ Entity 漂移守卫（B5-5）—— 防「同一形状写两遍」的机械护栏，纯 reflection、零 DB。
 *
 * 背景事实：menu meta 的默认值曾同时写在 dto 装饰器 `default`、entity `@Column default`、
 * `SYS_MENU_META_FIELD_MAP` 第三元与 migration DDL 四处；DTO 派生链（Create/Update/List）
 * 的字段口径也曾在 RealPartialType 下静默漂移。本守卫按三个维度把「DTO 基座类 ↔ 实体」
 * 的结构对齐钉死，漂移即红：
 *
 * ① 字段集合：每个 DTOBase 的 @Expose 字段 ⊆ 对应 entity 的属性集 ∪ 显式白名单
 *    （白名单逐条注释派生理由，不许静默扩）；
 * ② `SYS_MENU_META_FIELD_MAP` 的 columnKey 全部是 SysMenuEntity 的真实列；
 * ③ 注册完备：全仓 glob 出的每个 `*DTOBase` 都必须在下方清单里登记（modelName → entity），
 *    且 recover-registry 的 modelName → entityTarget 与本清单一致（SYS_DELETED 除外 ——
 *    sys_deleted 是快照表本体，不进回收站）。
 *
 * 附：menu Create/Update 口径快照（B5-5 统一后的 wire 白名单与必填核，改口径先改这里）。
 *
 * 值语义（回填默认值的具体取值、422 wire 行为）不在此处钉 —— 那是 menu.api-spec /
 * menu.role.pg.int-spec 的职责；本文件只拦「结构漂移」。
 */

interface IDtoEntityDriftCase {
  /** DTO 元数据基座类（*DTOBase） */
  dtoBase: ClassConstructor<object>
  /** 对应 PG 实体类 */
  entity: ClassConstructor<object>
  /** 软删快照路由键（WalnutDBModelName） */
  modelName: string
  /**
   * 字段白名单：DTO 有而 entity 无对应列的**已知派生字段**。
   * 每条必须写明派生机制与为什么不该有列 —— 无理由的字段是漂移，改 DTO 或改 entity，
   * 不是加白名单。
   */
  allowlist?: ReadonlyArray<readonly [field: string, reason: string]>
}

const DTO_ENTITY_CASES: ReadonlyArray<IDtoEntityDriftCase> = [
  { dtoBase: AppDemoDTOBase, entity: AppDemoEntity, modelName: WalnutDBModelName.APP_DEMO },
  { dtoBase: AppErrorDTOBase, entity: AppErrorEntity, modelName: WalnutDBModelName.APP_ERROR },
  { dtoBase: AppKeyDTOBase, entity: AppKeyEntity, modelName: WalnutDBModelName.APP_KEY },
  {
    dtoBase: AppMonitorUserDTOBase,
    entity: AppMonitorUserEntity,
    modelName: WalnutDBModelName.APP_MONITOR_USER,
    allowlist: [
      // entity 时间列按语义改名：first_visit_at / last_active_at（monitor-user.entity
      // CreateDate/UpdateDateColumn 改名映射）；DTO 沿用 Mongo 版 wire 字段名
      ['createdAt', 'entity 时间列改名 first_visit_at（monitor-user.entity），DTO 保留 Mongo 版 wire 名'],
      ['updatedAt', 'entity 时间列改名 last_active_at（monitor-user.entity），DTO 保留 Mongo 版 wire 名'],
    ],
  },
  { dtoBase: AppSettingDTOBase, entity: AppSettingEntity, modelName: WalnutDBModelName.APP_SETTING },
  {
    dtoBase: SharedAreaDTOBase,
    entity: SharedAreaEntity,
    modelName: WalnutDBModelName.SHARED_AREA,
    allowlist: [
      // area.entity Q12 定案 timestamps: false 不补审计列（补了全是 ETL 当刻时间）；
      // createdAt/updatedAt 是 DTO 基座继承的展示字段
      ['createdAt', 'area.entity Q12 定案无时间列（timestamps: false），基座继承的展示字段'],
      ['updatedAt', 'area.entity Q12 定案无时间列（timestamps: false），基座继承的展示字段'],
    ],
  },
  {
    dtoBase: SysDeletedDTOBase,
    entity: SysDeletedEntity,
    modelName: WalnutDBModelName.SYS_DELETED,
    allowlist: [
      // 快照表的行时间列是 deleted_at（deleted.entity 注释：原 createdAt 改名）；
      // createdAt/updatedAt 是 DTO 基座继承的展示字段
      ['createdAt', '快照表时间列是 deleted_at（deleted.entity 原 createdAt 改名），基座继承的展示字段'],
      ['updatedAt', '快照表时间列是 deleted_at（deleted.entity 原 createdAt 改名），基座继承的展示字段'],
    ],
  },
  {
    dtoBase: SysDeviceDTOBase,
    entity: SysDeviceEntity,
    modelName: WalnutDBModelName.SYS_DEVICE,
    allowlist: [
      // device.entity 注释：sr / vp / geo 已从 jsonb 拆成数值列（sr_height/sr_width/
      // vp_height/vp_width/geo_longitude/geo_latitude）；DTO 保留 Mongo 版嵌套形状，
      // 由 device.dto 的组装 helper 在出参侧重建（entity 列恒在，无漂移风险面）
      ['sr', '组装字段：entity 拍平列 sr_height/sr_width 重建的 {height,width}（device.dto helper）'],
      ['vp', '组装字段：entity 拍平列 vp_height/vp_width 重建的 {height,width}（device.dto helper）'],
      ['geoLocation', '组装字段：entity 拍平列 geo_longitude/geo_latitude 重建的 GeoPoint（device.dto helper）'],
    ],
  },
  { dtoBase: SysDictDataDTOBase, entity: SysDictDataEntity, modelName: WalnutDBModelName.SYS_DICT_DATA },
  {
    dtoBase: SysDictTypeDTOBase,
    entity: SysDictTypeEntity,
    modelName: WalnutDBModelName.SYS_DICT_TYPE,
    allowlist: [
      // populate 派生出参（Mongo 版 $lookup 出参字段名沿用）：dict_data 一对多 JOIN 计数
      ['populated_dictData', 'populate 派生出参：dictData 关联 JOIN 组装（WalnutDBVirtualName 同族）'],
      ['populated_dictDataCount', 'populate 派生出参：dictData 关联计数子查询'],
    ],
  },
  {
    dtoBase: SysLangDTOBase,
    entity: SysLangEntity,
    modelName: WalnutDBModelName.SYS_LANG,
    allowlist: [
      // populate 派生出参：locale 翻译进度（总数/已完成数），Mongo 版 $lookup 出参字段名沿用
      ['populated_localesTotalCount', 'populate 派生出参：locale 总数计数子查询'],
      ['populated_localesFinishedCount', 'populate 派生出参：locale 已完成计数子查询'],
    ],
  },
  { dtoBase: SysLocaleDTOBase, entity: SysLocaleEntity, modelName: WalnutDBModelName.SYS_LOCALE },
  {
    dtoBase: SysLogAuthDTOBase,
    entity: SysLogAuthEntity,
    modelName: WalnutDBModelName.SYS_LOG_AUTH,
    allowlist: [
      // entity 时间列改名 authenticated_at（log-auth.entity 注释：原 createdAt 改名）
      ['createdAt', 'entity 时间列改名 authenticated_at（log-auth.entity），DTO 保留 Mongo 版 wire 名'],
      ['updatedAt', '登录日志无更新时间列（entity 仅 authenticated_at），基座继承的展示字段'],
    ],
  },
  {
    dtoBase: SysLogOperateDTOBase,
    entity: SysLogOperateEntity,
    modelName: WalnutDBModelName.SYS_LOG_OPERATE,
    allowlist: [
      // entity 时间列改名 operated_at（log-operate.entity CreateDateColumn 改名映射）
      ['createdAt', 'entity 时间列改名 operated_at（log-operate.entity），DTO 保留 Mongo 版 wire 名'],
      ['updatedAt', '操作日志无更新时间列（entity 仅 operated_at），基座继承的展示字段'],
    ],
  },
  {
    dtoBase: SysMenuDTOBase,
    entity: SysMenuEntity,
    modelName: WalnutDBModelName.SYS_MENU,
    allowlist: [
      // meta 组装字段：19 个拍平列的出入参组装形态（flattenSysMenuMeta /
      // assembleSysMenuMeta，menu.dto.ts B5 迁移注释）—— entity 刻意无 meta 列（Q1 定案拍平）
      ['meta', 'meta 组装字段：19 拍平列的出参组装形态（phase2 4.3 Q1 定案拍平，entity 无 meta 列）'],
    ],
  },
  // SysMenuMetaDTOBase 是 meta 19 字段的元数据基座，字段全部落在 SysMenuEntity 拍平列上
  // （同一实体的第二张「投影面」，modelName 与 SysMenuDTOBase 同为 SYS_MENU）
  { dtoBase: SysMenuMetaDTOBase, entity: SysMenuEntity, modelName: WalnutDBModelName.SYS_MENU },
  {
    dtoBase: SysRoleDTOBase,
    entity: SysRoleEntity,
    modelName: WalnutDBModelName.SYS_ROLE,
    allowlist: [
      // role junction：原 menus: ObjectId[] 拆关联表 sys_role_menu（B5），DTO 保留同名
      // 出入参字段；populated_* 是 junction JOIN 的出参字段（Mongo 版 $lookup 名沿用）
      ['menus', 'junction sys_role_menu 派生的 uuid 数组（B5 迁移，entity 无列）'],
      ['populated_usersCount', 'populate 派生出参：usersCount 关联计数子查询'],
      ['populated_menusList', 'populate 派生出参：menus junction JOIN 组装（match meta.status）'],
    ],
  },
  {
    dtoBase: SysUserDTOBase,
    entity: SysUserEntity,
    modelName: WalnutDBModelName.SYS_USER,
    allowlist: [
      // user.entity.ts 注释：原 roles: ObjectId[] 已拆关联表 sys_user_role（junction 承接
      // 的 uuid 数组），DTO 保留同名出入参字段 —— junction 派生，无列
      ['roles', 'junction sys_user_role 派生的 uuid 数组（user.entity 注释：原 roles 拆关联表）'],
    ],
  },
  { dtoBase: SysUserDeviceDTOBase, entity: SysUserDeviceEntity, modelName: WalnutDBModelName.SYS_USER_DEVICE },
  { dtoBase: SysUserIdentityDTOBase, entity: SysUserIdentityEntity, modelName: WalnutDBModelName.SYS_USER_IDENTITY },
  { dtoBase: SysUserLockDTOBase, entity: SysUserLockEntity, modelName: WalnutDBModelName.SYS_USER_LOCK },
  { dtoBase: SysUserMfaDTOBase, entity: SysUserMfaEntity, modelName: WalnutDBModelName.SYS_USER_MFA },
  { dtoBase: SysUserOAuthDTOBase, entity: SysUserOauthEntity, modelName: WalnutDBModelName.SYS_USER_OAUTH },
  { dtoBase: SysUserPreferenceDTOBase, entity: SysUserPreferenceEntity, modelName: WalnutDBModelName.SYS_USER_PREFERENCE },
]

// ─── reflection 工具 ─────────────────────────────────────────────────────────────

/** entity 的属性全集：TypeORM 各 mode 的列（regular/primary/createDate/updateDate）∪ 原型声明 */
function entityPropertyNames(entity: ClassConstructor<object>): Set<string> {
  const columnProps = getMetadataArgsStorage().columns.filter(column => column.target === entity).map(column => column.propertyName)
  const prototypeProps = Object.getOwnPropertyNames(entity.prototype)
    .filter(name => name !== 'constructor')

  return new Set([...columnProps, ...prototypeProps])
}

/** DTOBase 的 @Expose 字段全集（与 RealPartialType/RealOmitType 同款枚举手法） */
function dtoExposedKeys(dtoBase: ClassConstructor<object>): string[] {
  return Object.keys(plainToInstance(dtoBase, {}))
}

/** entity 指定属性上的 @Column default（未声明 → null；函数形式就地求值） */
function entityColumnDefault(entity: ClassConstructor<object>, propertyName: string): unknown {
  const column = getMetadataArgsStorage().columns.find(candidate => candidate.target === entity && candidate.propertyName === propertyName)

  if (column === undefined) {
    return undefined
  }

  const def: unknown = column.options.default
  return typeof def === 'function' ? (def as () => unknown)() : def ?? null
}

// ③ 的机械完备面：fs 扫全仓 dto 文件 + 动态 import，收集导出的 *DTOBase 类名。
// 新增基座类不登记进 DTO_ENTITY_CASES → 本清单与扫描集合的差集即红。
// （动态 import 而非 import.meta.glob：server tsconfig 是 module=commonjs，
// import.meta 过不了 tsc；vitest 侧对绝对路径的动态 import 走同一 transform 管道。
// 这里只比对类名字符串，双实例不参与身份比较。）

function listDtoFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listDtoFiles(full))
    }
    else if (entry.isFile() && entry.name.endsWith('.dto.ts')) {
      found.push(full)
    }
  }
  return found
}

async function globFoundDtoBaseNames(): Promise<Set<string>> {
  const found = new Set<string>()
  const dtoDir = resolve(process.cwd(), 'apps/api/src/modules')

  for (const file of listDtoFiles(dtoDir)) {
    const namespace = await import(pathToFileURL(file).href) as Record<string, unknown>
    for (const value of Object.values(namespace)) {
      if (typeof value === 'function' && value.name.endsWith('DTOBase')) {
        found.add(value.name)
      }
    }
  }
  return found
}

// ─── 用例 ────────────────────────────────────────────────────────────────────────

describe('dto ↔ entity 漂移守卫（纯 reflection，防同一形状写两遍漂移）', () => {
  it('① 每个 DTOBase 的 @Expose 字段 ⊆ entity 属性集 ∪ 显式白名单', () => {
    const problems: string[] = []

    for (const { dtoBase, entity, allowlist } of DTO_ENTITY_CASES) {
      const entityProps = entityPropertyNames(entity)
      const allowed = new Set((allowlist ?? []).map(([field]) => field))
      const missing = dtoExposedKeys(dtoBase)
        .filter(field => !entityProps.has(field) && !allowed.has(field))

      if (missing.length > 0) {
        problems.push(`${dtoBase.name}: 字段不在 ${entity.name} 也不在白名单 → [${missing.join(', ')}]`)
      }
    }

    expect(problems).toEqual([])
  })

  it('①b 白名单字段真实存在于 DTO（防白名单写错名失效成摆设）', () => {
    const problems: string[] = []

    for (const { dtoBase, allowlist } of DTO_ENTITY_CASES) {
      const dtoKeys = new Set(dtoExposedKeys(dtoBase))
      for (const [field] of allowlist ?? []) {
        if (!dtoKeys.has(field)) {
          problems.push(`${dtoBase.name}: 白名单字段 "${field}" 在 DTO 上不存在（改名后白名单未同步）`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('② SYS_MENU_META_FIELD_MAP 的 columnKey 全部是 SysMenuEntity 的真实列，且 flatten 回填值与 entity @Column default 一致', () => {
    const entityProps = entityPropertyNames(SysMenuEntity)
    const columnKeys = SYS_MENU_META_FIELD_MAP.map(([, columnKey]) => columnKey)

    for (const columnKey of columnKeys) {
      expect(entityProps.has(columnKey), `拍平列属性 "${columnKey}" 不在 SysMenuEntity 上`).toBe(true)
    }

    // 默认值单源化后的回填一致性：meta 空对象拆平 → 19 列全量产出，值 === entity 元数据
    // 的 default（含可空列的 NULL），不重嵌字面量（字面量由 api-spec 钉）
    const flattened = flattenSysMenuMeta({ meta: {} })
    for (const columnKey of columnKeys) {
      expect(flattened[columnKey as keyof typeof flattened]).toEqual(entityColumnDefault(SysMenuEntity, columnKey))
    }

    // 出参组装同源：meta 空实体 → 19 键 meta 对象，默认值同上
    const assembled = assembleSysMenuMeta({})
    expect(Object.keys(assembled)).toHaveLength(SYS_MENU_META_FIELD_MAP.length)
    for (const [metaKey, columnKey] of SYS_MENU_META_FIELD_MAP) {
      expect(assembled[metaKey]).toEqual(entityColumnDefault(SysMenuEntity, columnKey))
    }
  })

  it('③ 注册完备：全仓 *DTOBase 都在清单里；modelName → entity 与 recover-registry 一致', async () => {
    const found = await globFoundDtoBaseNames()
    const mapped = new Set(DTO_ENTITY_CASES.map(({ dtoBase }) => dtoBase.name))

    const unregistered = [...found].filter(name => !mapped.has(name))
    const stale = [...mapped].filter(name => !found.has(name))
    expect(unregistered, '新 DTOBase 未登记进 DTO_ENTITY_CASES').toEqual([])
    expect(stale, '清单里的 DTOBase 已不存在（改名/删除后未同步）').toEqual([])

    // 同名 DTOBase 唯一（不存在一个基座登记两次）
    expect(DTO_ENTITY_CASES.length).toBe(mapped.size)

    // recover-registry 对账：除快照表本体外，登记的 modelName 都可恢复且实体同源
    const registry = new Map(WALNUT_PG_RECOVERABLE_COLLECTIONS.map(entry => [entry.modelName, entry.entityTarget]))
    for (const { modelName, entity } of DTO_ENTITY_CASES) {
      if (modelName === WalnutDBModelName.SYS_DELETED) {
        // sys_deleted 是快照表本体，不进回收站（recover-registry 注释）
        expect(registry.has(modelName)).toBe(false)
        continue
      }
      expect(registry.get(modelName), `${modelName} 未注册恢复器`).toBe(entity)
    }
  })
})

describe('menu Create/Update 口径快照（B5-5 统一后的 wire 白名单与必填核）', () => {
  const CREATE_REQUIRED = ['type']
  const CREATE_OPTIONAL = ['pid', 'path', 'name', 'component', 'title', 'icon', 'meta']

  it('create 白名单 = type 必填核 ∪ 可选余部（id/createdAt/updatedAt 不进写路径）', () => {
    const keys = dtoExposedKeys(SysMenuDTOCreateRequest).sort()

    expect(keys).toEqual([...CREATE_REQUIRED, ...CREATE_OPTIONAL].sort())
  })

  it('create 校验：缺 type 报错且只报 type；缺可选字段不报错', () => {
    const missingAll = validateSync(plainToInstance(SysMenuDTOCreateRequest, {}))
    expect(missingAll.map(error => error.property)).toEqual(CREATE_REQUIRED)

    const full = plainToInstance(SysMenuDTOCreateRequest, {
      type: 'catalog',
      pid: null,
      path: '/x',
      name: 'X',
      component: 'x/index',
      title: 'app.x',
      icon: 'mdi:x',
      meta: { order: 1 },
    })
    expect(validateSync(full)).toEqual([])
  })

  it('update = RealPartialType(create)：白名单同 create、全字段可选', () => {
    expect(dtoExposedKeys(SysMenuDTOUpdateRequest).sort()).toEqual(dtoExposedKeys(SysMenuDTOCreateRequest).sort())

    const partial = plainToInstance(SysMenuDTOUpdateRequest, { title: 'only title', meta: { order: 2 } })
    expect(validateSync(partial)).toEqual([])

    const empty = plainToInstance(SysMenuDTOUpdateRequest, {})
    expect(validateSync(empty)).toEqual([])
  })
})
