/**
 * ETL 的**类型映射 / 引用重写 / junction 拆分**层 —— `db:etl`（Mongo→PG）、`db:seed:pg`
 * （seed JSON→PG）与 `db:verify-etl`（对账）三条通道共用的唯一真源。
 *
 * ## 为什么映射必须抽成纯函数
 *
 * 三个入口读到的源形态不同（Mongo 驱动 / Extended JSON 文件），但**落到 PG 的必须是同一批值**：
 * 对账（verify-etl）就是「同一份 Mongo 文档再映射一遍，与 PG 里的行逐列比对」。映射散在三个
 * 脚本里，对账就失去意义 —— 所以这里只有纯函数：输入一个 Mongo 形态的文档，输出一行（或一行
 * + junction 行），值全部**就地定型**（Date / number / boolean / jsonb 对象 / 数组 / null），
 * 写入器不做任何二次加工。缺省值也在这里补齐（schema default / phase2 §4 的 DEFAULT 列），
 * 缺了数据（NOT NULL 列来了 null）直接抛 —— fail-closed，不猜。
 *
 * ## 映射依据
 *
 * `postgres-migration-phase2.md` §4 逐表清单 + 各 PG 实体（`apps/api/src/modules` 下各 `entity/`）。
 * 改任何一行映射，先对文档/实体，再改这里，最后跑 `src/db/__tests__/etl-map.test.ts`。
 *
 * ## 口径要点（容易写错的三条）
 *
 * - **历史 hex 不进 PG**：所有 `_id` 与 uuid 引用列走 v5 派生（`uuid5.ts`）；但 jsonb **内容里**
 *   的历史 hex 字符串（如 log 的请求快照）**不重写** —— 那是历史数据，没有引用语义。
 *   唯一例外是 `app_setting.setting_value`：它承载活引用（`app.default.role`），role hex
 *   在此专项重写（phase2 Q4 定案）。
 * - **menu.meta 拍平**（phase2 Q1 定案）：19 个 meta 字段进独立列；文档没有 `meta` 键（老根节点）
 *   时按 schema 缺省补齐，不许 NULL 掉 NOT NULL 列。
 * - **stringify 列 parse**（phase2 Q7 定案）：`sys_log_operate.request_data/responseData` 与
 *   `app_error.payload` 的字符串成员 parse 入 jsonb；parse 失败本列 NULL、原文落 `raw_*` 旁路，
 *   零丢失。
 */
import type { ObjectId } from 'mongodb'
import { ViolationError } from '../lib/errors.ts'
import { deriveUuidFromObjectId, isObjectIdHex, UUID_RE } from './uuid5.ts'

/** 映射上下文：setting_value 重写需要知道哪些 hex 是存量 role id（来自 Mongo sys_role） */
export interface EtlMapContext {
  roleHexes: ReadonlySet<string>
}

/** 映射产物：一行业务表 + 可选的 junction 行（roles/menus 数组拆分） */
export interface MappedDoc {
  /** 目标 PG 表名（与集合名一致，junction 表除外） */
  table: string
  /** 一行数据（列名 → 驱动可直传的值；无 undefined） */
  row: Record<string, unknown>
  /** junction 拆分产物（sys_user.roles / sys_role.menus） */
  junction?: { table: string, rows: Record<string, unknown>[] }
}

export type CollectionMapper = (doc: Record<string, unknown>, ctx: EtlMapContext) => MappedDoc

// ---------------------------------------------------------------------------
// 标量归一
// ---------------------------------------------------------------------------

/** ObjectId 实例 / 24 位 hex / 已是 uuid（export-pg 回灌通道）→ uuid；空值抛 */
export function refUuid(value: unknown, field: string): string {
  if (value === null || value === undefined)
    throw new ViolationError(`引用列 ${field} 拿到了空值 —— NOT NULL 引用不允许兜底`)
  if (isObjectIdValue(value))
    return deriveUuidFromObjectId(objectIdHex(value))
  if (typeof value === 'string') {
    if (isObjectIdHex(value))
      return deriveUuidFromObjectId(value)
    if (UUID_RE.test(value))
      return value.toLowerCase()
  }
  throw new ViolationError(`引用列 ${field} 既不是 ObjectId hex 也不是 uuid：${String(value)}`)
}

/** 可空引用：null/undefined → null，其余同 `refUuid` */
export function refUuidOrNull(value: unknown, field: string): string | null {
  if (value === null || value === undefined)
    return null
  return refUuid(value, field)
}

function isObjectIdValue(value: unknown): value is ObjectId {
  return typeof value === 'object' && value !== null
    && (value as { _bsontype?: unknown })._bsontype === 'ObjectId'
}

function objectIdHex(value: ObjectId): string {
  return value.toHexString()
}

export function strOrNull(value: unknown): string | null {
  if (value === null || value === undefined)
    return null
  return String(value)
}

/** NOT NULL 文本列：缺了就抛（fail-closed，不造空串） */
export function reqStr(value: unknown, field: string): string {
  if (value === null || value === undefined || value === '')
    throw new ViolationError(`NOT NULL 列 ${field} 拿到了空值 —— 先修数据（phase2 7.3 预检口径）`)
  return String(value)
}

export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined)
    return null
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new ViolationError(`数值列拿到非有限数值：${String(value)}`)
  return value
}

export function boolOr(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined)
    return fallback
  if (typeof value !== 'boolean')
    throw new ViolationError(`布尔列拿到非布尔值：${String(value)}`)
  return value
}

export function numOr(value: unknown, fallback: number): number {
  if (value === null || value === undefined)
    return fallback
  const n = numOrNull(value)
  return n ?? fallback
}

/** NOT NULL 数值列：缺了就抛（不造 0） */
export function reqNum(value: unknown, field: string): number {
  const n = numOrNull(value)
  if (n === null)
    throw new ViolationError(`NOT NULL 数值列 ${field} 拿到了空值 —— 先修数据`)
  return n
}

export function strOr(value: unknown, fallback: string): string {
  const s = strOrNull(value)
  return s ?? fallback
}

/** Mongo 侧的 Date / ISO 字符串 / epoch 毫秒 → Date；空值 → null */
export function tsOrNull(value: unknown): Date | null {
  if (value === null || value === undefined)
    return null
  if (value instanceof Date)
    return value
  if (typeof value === 'string' || typeof value === 'number')
    return new Date(value)
  throw new ViolationError(`时间列拿到不可解析的值：${String(value)}`)
}

/** NOT NULL 时间列（created_at/updated_at 等）：缺了就抛 */
export function reqTs(value: unknown, field: string): Date {
  const d = tsOrNull(value)
  if (d === null)
    throw new ViolationError(`NOT NULL 时间列 ${field} 拿到了空值 —— Mongo 文档缺时间戳，先修数据`)
  return d
}

/** 数组列（text[] / uuid[] / timestamptz[] …）：缺省给 fallback 的浅拷贝；非数组抛 */
export function arrOr<T>(value: unknown, fallback: readonly T[]): T[] {
  if (value === null || value === undefined)
    return [...fallback]
  if (!Array.isArray(value))
    throw new ViolationError(`数组列拿到非数组值：${String(value)}`)
  return value as T[]
}

/** 去重并保持原序（junction 拆分用：复合 PK 天然去重，重复引用只落一行） */
export function dedupeKeepOrder(values: readonly string[]): string[] {
  return [...new Set(values)]
}

// ---------------------------------------------------------------------------
// Q7：stringify 列 → jsonb + raw 旁路
// ---------------------------------------------------------------------------

export interface ParsedJsonOrRaw {
  /** parse 成功时的 JSON 值；失败或空串时 null */
  parsed: Record<string, unknown> | null
  /** parse 失败时的原文（零丢失旁路）；成功或空串时 null */
  raw: string | null
}

/**
 * Mongo 侧 stringify 字符串 → jsonb。
 * 空串 / 纯空白视为「没数据」（两侧都 NULL），不算 parse 失败 —— 那会让旁路列塞满空串噪声。
 * 应用已经开始直写对象的新数据（对象形态）原样通过。
 */
export function parseStringifiedJson(value: unknown): ParsedJsonOrRaw {
  if (value === null || value === undefined)
    return { parsed: null, raw: null }
  if (typeof value === 'object')
    return { parsed: value as Record<string, unknown>, raw: null }
  const text = String(value)
  if (text.trim() === '')
    return { parsed: null, raw: null }
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed === null || typeof parsed !== 'object')
      return { parsed: null, raw: text }
    return { parsed: parsed as Record<string, unknown>, raw: null }
  }
  catch {
    return { parsed: null, raw: text }
  }
}

export interface ErrorPayloadMapping {
  /** app_error.payload（jsonb） */
  payload: Record<string, unknown> | null
  /** app_error.raw_payload（原文旁路） */
  rawPayload: string | null
}

/**
 * app_error.payload 的 Q7 映射：Mongo 里是 `{ body, params, query }`，**每个成员是 stringify
 * 字符串**。逐成员 parse，全成功 → jsonb 对象；任一失败 → 本列 NULL、整体原文序列化进 raw_payload。
 * 新数据（成员已是对象）原样保留。
 */
export function mapErrorPayload(payload: unknown): ErrorPayloadMapping {
  if (payload === null || payload === undefined)
    return { payload: null, rawPayload: null }
  if (typeof payload === 'string')
    return remapStringifiedPayload(payload)
  if (typeof payload !== 'object')
    throw new ViolationError(`app_error.payload 形态未知：${String(payload)}`)

  const source = payload as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value !== 'string') {
      out[key] = value
      continue
    }
    const { parsed } = parseStringifiedJson(value)
    if (parsed === null) {
      return { payload: null, rawPayload: JSON.stringify(payload) }
    }
    out[key] = parsed
  }
  return { payload: out, rawPayload: null }
}

function remapStringifiedPayload(text: string): ErrorPayloadMapping {
  const { parsed, raw } = parseStringifiedJson(text)
  if (parsed === null)
    return { payload: null, rawPayload: raw ?? text }
  return mapErrorPayload(parsed)
}

// ---------------------------------------------------------------------------
// Q4：app_setting.setting_value 的 role hex 专项重写
// ---------------------------------------------------------------------------

/**
 * setting_value 的三种形态与处理：
 * - 整值就是 role hex → 重写为 v5（不在存量 role 集里 → 抛，不盲改，与 B5 订正脚本同口径）；
 * - 整值已是 uuid → 原样（幂等）；
 * - JSON 文本 → 递归找**恰好是存量 role hex** 的字符串值替换为 v5；非 role 的 hex 与
 *   jsonb 里的历史串一律不动。parse 失败（如 `"0"`、`"[]"` 外的杂值）→ 原样返回。
 */
export function mapSettingValue(value: unknown, ctx: EtlMapContext): string {
  const text = reqStr(value, 'app_setting.setting_value')
  if (UUID_RE.test(text))
    return text
  if (isObjectIdHex(text)) {
    if (!ctx.roleHexes.has(text))
      throw new ViolationError(`setting_value 的整值 hex ${text} 不在 Mongo sys_role 存量里 —— 数据形态未知，拒绝改写`)
    return deriveUuidFromObjectId(text)
  }
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('['))
    return text
  try {
    return JSON.stringify(rewriteEmbeddedRoleHex(JSON.parse(text), ctx))
  }
  catch {
    return text
  }
}

function rewriteEmbeddedRoleHex(node: unknown, ctx: EtlMapContext): unknown {
  if (typeof node === 'string') {
    if (isObjectIdHex(node) && ctx.roleHexes.has(node))
      return deriveUuidFromObjectId(node)
    return node
  }
  if (Array.isArray(node))
    return node.map(item => rewriteEmbeddedRoleHex(item, ctx))
  if (node !== null && typeof node === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(node))
      out[key] = rewriteEmbeddedRoleHex(value, ctx)
    return out
  }
  return node
}

// ---------------------------------------------------------------------------
// 公共行片段
// ---------------------------------------------------------------------------

function commonTimestamps(doc: Record<string, unknown>): { created_at: Date, updated_at: Date } {
  return {
    created_at: reqTs(doc.createdAt, 'created_at'),
    updated_at: reqTs(doc.updatedAt, 'updated_at'),
  }
}

function rowId(doc: Record<string, unknown>, table: string): string {
  return refUuid(doc._id, `${table}._id`)
}

function metaOf(doc: Record<string, unknown>): Record<string, unknown> {
  const meta = doc.meta
  if (meta === null || meta === undefined)
    return {}
  if (typeof meta !== 'object' || Array.isArray(meta))
    throw new ViolationError(`sys_menu.meta 形态未知：${String(meta)}`)
  return meta as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// 逐表 mapper（依 phase2 §4 + PG 实体逐列对齐；顺序 = 装载顺序，父表在前）
// ---------------------------------------------------------------------------

function mapSysLang(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_lang',
    row: {
      id: rowId(doc, 'sys_lang'),
      lang: reqStr(doc.lang, 'sys_lang.lang'),
      description: strOrNull(doc.description),
      sort_order: numOrNull(doc.order),
      status: boolOr(doc.status, true),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysLocale(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_locale',
    row: {
      id: rowId(doc, 'sys_locale'),
      lang_id: refUuid(doc.langId, 'sys_locale.langId'),
      key: reqStr(doc.key, 'sys_locale.key'),
      value: strOrNull(doc.value),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysDictType(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_dict_type',
    row: {
      id: rowId(doc, 'sys_dict_type'),
      name: reqStr(doc.name, 'sys_dict_type.name'),
      type: reqStr(doc.type, 'sys_dict_type.type'),
      status: boolOr(doc.status, true),
      description: strOrNull(doc.description),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysDictData(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_dict_data',
    row: {
      id: rowId(doc, 'sys_dict_data'),
      type_id: refUuid(doc.typeId, 'sys_dict_data.typeId'),
      label: reqStr(doc.label, 'sys_dict_data.label'),
      value: reqStr(doc.value, 'sys_dict_data.value'),
      sort_order: numOr(doc.order, 0),
      status: boolOr(doc.status, true),
      tag_type: strOr(doc.tagType, 'primary'),
      description: strOrNull(doc.description),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysRole(doc: Record<string, unknown>): MappedDoc {
  const id = rowId(doc, 'sys_role')
  const menus = dedupeKeepOrder(arrOr<string>(doc.menus, []).map(hex => refUuid(hex, 'sys_role.menus[]')))
  return {
    table: 'sys_role',
    row: {
      id,
      role_name: reqStr(doc.roleName, 'sys_role.roleName'),
      description: strOrNull(doc.description),
      sort_order: numOrNull(doc.order),
      status: boolOr(doc.status, true),
      ...commonTimestamps(doc),
    },
    junction: { table: 'sys_role_menu', rows: menus.map(menuId => ({ role_id: id, menu_id: menuId })) },
  }
}

function mapSysMenu(doc: Record<string, unknown>): MappedDoc {
  const meta = metaOf(doc)
  return {
    table: 'sys_menu',
    row: {
      id: rowId(doc, 'sys_menu'),
      // 根节点文档完全没有 pid 键（phase2 4.3 查实）→ NULL
      pid: refUuidOrNull(doc.pid, 'sys_menu.pid'),
      type: strOr(doc.type, 'catalog'),
      path: strOrNull(doc.path),
      name: strOrNull(doc.name),
      component: strOrNull(doc.component),
      title: strOrNull(doc.title),
      icon: strOrNull(doc.icon),
      sort_order: numOrNull(meta.order),
      ternal: strOr(meta.ternal, 'none'),
      url: strOrNull(meta.url),
      is_show: boolOr(meta.show, true),
      cache: boolOr(meta.cache, false),
      status: boolOr(meta.status, true),
      affix: boolOr(meta.affix, false),
      permission: strOrNull(meta.permission),
      menu_active_name: strOrNull(meta.menuActiveName),
      menu_active_same_tab: boolOr(meta.menuActiveSameTab, false),
      badge: strOrNull(meta.badge),
      active_icon: strOrNull(meta.activeIcon),
      position: boolOr(meta.position, false),
      leave_tip: boolOr(meta.leaveTip, false),
      mask_url: boolOr(meta.maskUrl, false),
      hijack_refresh: boolOr(meta.hijackRefresh, false),
      watermark: meta.watermark === undefined ? null : meta.watermark,
      transition: strOr(meta.transition, 'fade'),
      cache_key_strategy: strOrNull(meta.cacheKeyStrategy),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUser(doc: Record<string, unknown>): MappedDoc {
  const id = rowId(doc, 'sys_user')
  const roles = dedupeKeepOrder(arrOr<string>(doc.roles, []).map(hex => refUuid(hex, 'sys_user.roles[]')))
  return {
    table: 'sys_user',
    row: {
      id,
      user_name: strOrNull(doc.userName),
      nick_name: strOrNull(doc.nickName),
      age: numOrNull(doc.age),
      gender: numOr(doc.gender, 9),
      avatar: strOrNull(doc.avatar),
      description: strOrNull(doc.description),
      status: boolOr(doc.status, true),
      role_mode: strOr(doc.roleMode, 'switchable'),
      current_role_id: refUuidOrNull(doc.currentRole, 'sys_user.currentRole'),
      mfa_setup: boolOr(doc.mfaSetup, false),
      ...commonTimestamps(doc),
    },
    junction: { table: 'sys_user_role', rows: roles.map(roleId => ({ user_id: id, role_id: roleId })) },
  }
}

function mapSysDevice(doc: Record<string, unknown>): MappedDoc {
  const sr = sub(doc.sr, 'sys_device.sr')
  const vp = sub(doc.vp, 'sys_device.vp')
  const geo = sub(doc.geoLocation, 'sys_device.geoLocation')
  const coordinates = Array.isArray(geo?.coordinates) ? geo.coordinates : []
  return {
    table: 'sys_device',
    row: {
      id: rowId(doc, 'sys_device'),
      device_name: reqStr(doc.deviceName, 'sys_device.deviceName'),
      device_id: reqStr(doc.deviceId, 'sys_device.deviceId'),
      device_info: doc.deviceInfo === undefined ? {} : doc.deviceInfo,
      hardware_info: doc.hardwareInfo === undefined ? null : doc.hardwareInfo,
      location_info: doc.locationInfo === undefined ? null : doc.locationInfo,
      location_history: arrOr(doc.locationHistory, []),
      sr_height: numOrNull(sr?.height),
      sr_width: numOrNull(sr?.width),
      vp_height: numOrNull(vp?.height),
      vp_width: numOrNull(vp?.width),
      ip: strOrNull(doc.ip),
      ip_history: arrOr<string>(doc.ipHistory, []),
      active: boolOr(doc.active, false),
      locked: boolOr(doc.locked, false),
      banned: boolOr(doc.banned, false),
      private: boolOr(doc.private, false),
      // GeoJSON Point：coordinates = [经度, 纬度]（可为 null 成员）
      geo_longitude: numOrNull(coordinates[0]),
      geo_latitude: numOrNull(coordinates[1]),
      risk_score: numOr(doc.riskScore, 0),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUserDevice(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_user_device',
    row: {
      id: rowId(doc, 'sys_user_device'),
      device_name: strOrNull(doc.deviceName),
      user_id: refUuid(doc.userId, 'sys_user_device.userId'),
      device_id: reqStr(doc.deviceId, 'sys_user_device.deviceId'),
      link: boolOr(doc.link, false),
      link_type: strOr(doc.linkType, 'system'),
      locked: boolOr(doc.locked, false),
      last_active_at: tsOrNull(doc.lastActiveAt),
      trusted: boolOr(doc.trusted, false),
      trusted_expired_at: tsOrNull(doc.trustedExpiredAt),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUserIdentity(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_user_identity',
    row: {
      id: rowId(doc, 'sys_user_identity'),
      user_id: refUuid(doc.userId, 'sys_user_identity.userId'),
      type: reqStr(doc.type, 'sys_user_identity.type'),
      purpose: reqStr(doc.purpose, 'sys_user_identity.purpose'),
      value: reqStr(doc.value, 'sys_user_identity.value'),
      value_hash: reqStr(doc.valueHash, 'sys_user_identity.valueHash'),
      masked_value: reqStr(doc.maskedValue, 'sys_user_identity.maskedValue'),
      verified: boolOr(doc.verified, false),
      verified_at: tsOrNull(doc.verifiedAt),
      is_primary: boolOr(doc.isPrimary, true),
      status: boolOr(doc.status, true),
      metadata: doc.metadata === undefined ? {} : doc.metadata,
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUserLock(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_user_lock',
    row: {
      id: rowId(doc, 'sys_user_lock'),
      user_id: refUuid(doc.userId, 'sys_user_lock.userId'),
      lock_route: doc.lockRoute === undefined ? {} : doc.lockRoute,
      lock_pwd_hash: strOrNull(doc.lockPwdHash),
      lock_mode: strOr(doc.lockMode, 'default'),
      lock_idle_sec: numOr(doc.lockIdleSec, 600),
      lock_security_sec: numOr(doc.lockSecuritySec, 60),
      lock_cross_device: boolOr(doc.lockCrossDevice, true),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUserMfa(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_user_mfa',
    row: {
      id: rowId(doc, 'sys_user_mfa'),
      user_id: refUuid(doc.userId, 'sys_user_mfa.userId'),
      type: reqStr(doc.type, 'sys_user_mfa.type'),
      device_id: reqStr(doc.deviceId, 'sys_user_mfa.deviceId'),
      name: reqStr(doc.name, 'sys_user_mfa.name'),
      totp_secret_ciphertext: strOrNull(doc.totpSecretCiphertext),
      webauthn_credential_id: strOrNull(doc.webauthnCredentialId),
      webauthn_public_key: strOrNull(doc.webauthnPublicKey),
      webauthn_counter: numOr(doc.webauthnCounter, 0),
      webauthn_transports: arrOr<string>(doc.webauthnTransports, []),
      phone_number_ciphertext: strOrNull(doc.phoneNumberCiphertext),
      backup_codes_ciphertext: arrOr<string>(doc.backupCodesCiphertext, []),
      status: boolOr(doc.status, true),
      last_used_at: tsOrNull(doc.lastUsedAt),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUserOauth(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_user_oauth',
    row: {
      id: rowId(doc, 'sys_user_oauth'),
      user_id: refUuid(doc.userId, 'sys_user_oauth.userId'),
      provider: reqStr(doc.provider, 'sys_user_oauth.provider'),
      provider_id: reqStr(doc.providerId, 'sys_user_oauth.providerId'),
      status: boolOr(doc.status, true),
      ...commonTimestamps(doc),
    },
  }
}

function mapSysUserPreference(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_user_preference',
    row: {
      id: rowId(doc, 'sys_user_preference'),
      user_id: refUuid(doc.userId, 'sys_user_preference.userId'),
      font_size: numOr(doc.fontSize, 14),
      dark: boolOr(doc.dark, false),
      reduced_motion: boolOr(doc.reducedMotion, false),
      color_mode: strOr(doc.colorMode, 'default'),
      cvd: strOrNull(doc.CVD ?? doc.cvd),
      locale: strOr(doc.locale, 'zh_CN'),
      layout_mode: strOr(doc.layoutMode, 'left-menu'),
      layout: doc.layout === undefined ? {} : doc.layout,
      ...commonTimestamps(doc),
    },
  }
}

function mapSysLogAuth(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'sys_log_auth',
    row: {
      id: rowId(doc, 'sys_log_auth'),
      ip: strOrNull(doc.ip),
      location: strOrNull(doc.location),
      os: strOrNull(doc.os),
      browser: strOrNull(doc.browser),
      user_id: refUuidOrNull(doc.userId, 'sys_log_auth.userId'),
      user_name: strOrNull(doc.userName),
      identifier: strOrNull(doc.identifier),
      success: boolOr(doc.success, false),
      msg: strOrNull(doc.msg),
      type: reqStr(doc.type, 'sys_log_auth.type'),
      device_id: strOrNull(doc.deviceId),
      authenticated_at: reqTs(doc.authenticatedAt ?? doc.createdAt, 'sys_log_auth.authenticatedAt'),
    },
  }
}

function mapSysLogOperate(doc: Record<string, unknown>): MappedDoc {
  const request = parseStringifiedJson(doc.requestData)
  const response = parseStringifiedJson(doc.responseData)
  return {
    table: 'sys_log_operate',
    row: {
      id: rowId(doc, 'sys_log_operate'),
      title: reqStr(doc.title, 'sys_log_operate.title'),
      action_type: reqStr(doc.actionType, 'sys_log_operate.actionType'),
      operation: strOrNull(doc.operation),
      method: strOrNull(doc.method),
      url: strOrNull(doc.url),
      http_version: strOrNull(doc.httpVersion),
      location: strOrNull(doc.location),
      os: strOrNull(doc.os),
      browser: strOrNull(doc.browser),
      status_code: numOrNull(doc.statusCode),
      request_data: request.parsed,
      response_data: response.parsed,
      raw_request_data: request.raw,
      raw_response_data: response.raw,
      corresponding_ms: numOrNull(doc.correspondingMS),
      user_id: refUuidOrNull(doc.userId, 'sys_log_operate.userId'),
      user_name: strOrNull(doc.userName),
      device_id: strOrNull(doc.deviceId),
      ip: strOrNull(doc.ip),
      invoking_method: strOrNull(doc.invokingMethod),
      success: typeof doc.success === 'boolean' ? doc.success : null,
      snapshot_before: snapshotJson(doc.snapshotBefore, 'snapshot_before'),
      snapshot_after: snapshotJson(doc.snapshotAfter, 'snapshot_after'),
      operated_at: reqTs(doc.operatedAt ?? doc.createdAt, 'sys_log_operate.operatedAt'),
    },
  }
}

/** snapshot 列无 raw 旁路 —— 字符串形态必须 parse 得动，否则 fail-closed 抛 */
function snapshotJson(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null || value === undefined)
    return null
  if (typeof value === 'object')
    return value as Record<string, unknown>
  const { parsed, raw } = parseStringifiedJson(value)
  if (parsed === null)
    throw new ViolationError(`sys_log_operate.${field} 的字符串 parse 失败且无旁路列（原文前 80 字：${(raw ?? '').slice(0, 80)}）`)
  return parsed
}

function mapSysDeleted(doc: Record<string, unknown>): MappedDoc {
  const content = typeof doc.content === 'string' ? JSON.parse(doc.content) : doc.content
  if (content === null || typeof content !== 'object')
    throw new ViolationError('sys_deleted.content parse 后不是对象 —— 拒绝落库')
  return {
    table: 'sys_deleted',
    row: {
      id: rowId(doc, 'sys_deleted'),
      content,
      model_name: reqStr(doc.modelName, 'sys_deleted.modelName'),
      collection_name: reqStr(doc.collectionName, 'sys_deleted.collectionName'),
      deleted_id: refUuid(doc.deletedId, 'sys_deleted.deletedId'),
      deleted_by: refUuid(doc.deletedBy, 'sys_deleted.deletedBy'),
      log_operate_id: refUuidOrNull(doc.logOperateId, 'sys_deleted.logOperateId'),
      deleted_at: tsOrNull(doc.deletedAt ?? doc.createdAt),
    },
  }
}

function mapSharedArea(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'shared_area',
    row: {
      id: rowId(doc, 'shared_area'),
      code: reqStr(doc.code, 'shared_area.code'),
      name: reqStr(doc.name, 'shared_area.name'),
      pcode: reqStr(doc.pcode, 'shared_area.pcode'),
    },
  }
}

function mapAppSetting(doc: Record<string, unknown>, ctx: EtlMapContext): MappedDoc {
  return {
    table: 'app_setting',
    row: {
      id: rowId(doc, 'app_setting'),
      setting_name: reqStr(doc.settingName, 'app_setting.settingName'),
      setting_key: reqStr(doc.settingKey, 'app_setting.settingKey'),
      setting_value: mapSettingValue(doc.settingValue, ctx),
      setting_type: reqStr(doc.settingType, 'app_setting.settingType'),
      remark: strOrNull(doc.remark),
      created_by: refUuidOrNull(doc.createdBy, 'app_setting.createdBy'),
      ...commonTimestamps(doc),
    },
  }
}

function mapAppDemo(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'app_demo',
    row: {
      id: rowId(doc, 'app_demo'),
      demo_string: strOrNull(doc.demoString),
      demo_phone_number: strOrNull(doc.demoPhoneNumber),
      demo_string_array: arrOr<string>(doc.demoStringArray, []),
      demo_number: numOrNull(doc.demoNumber),
      demo_number_array: arrOr<number>(doc.demoNumberArray, []),
      demo_boolean: boolOr(doc.demoBoolean, false),
      demo_boolean_array: arrOr<boolean>(doc.demoBooleanArray, []),
      demo_date: tsOrNull(doc.demoDate),
      demo_date_array: arrOr<unknown>(doc.demoDateArray, []).map(d => tsOrNull(d)),
      demo_enum: numOr(doc.demoEnum, 1),
      demo_enum_array: arrOr<number>(doc.demoEnumArray, []),
      demo_uuid: refUuidOrNull(doc.demoMongoId, 'app_demo.demoMongoId'),
      demo_uuid_array: arrOr<unknown>(doc.demoMongoIdArray, []).map(d => refUuidOrNull(d, 'app_demo.demoMongoIdArray[]')),
      demo_object: doc.demoObject === undefined ? null : doc.demoObject,
      ...commonTimestamps(doc),
    },
  }
}

function mapAppMonitorUser(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'app_monitor_user',
    row: {
      id: rowId(doc, 'app_monitor_user'),
      visitor_id: reqStr(doc.visitorId, 'app_monitor_user.visitorId'),
      user_id: refUuidOrNull(doc.userId, 'app_monitor_user.userId'),
      device_id: strOrNull(doc.deviceId),
      auth: boolOr(doc.auth, false),
      // Mongo schema 的 focus default 是 true（PG 实体 default false 是 Phase 3 口径，
      // 存量缺键时按**源 schema** 缺省 —— 数据侧不因迁移改变语义）
      focus: boolOr(doc.focus, true),
      is_left: boolOr(doc.left, false),
      current_router: strOrNull(doc.currentRouter),
      first_visit_at: reqTs(doc.firstVisitAt, 'app_monitor_user.firstVisitAt'),
      last_active_at: reqTs(doc.lastActiveAt, 'app_monitor_user.lastActiveAt'),
    },
  }
}

function mapAppError(doc: Record<string, unknown>): MappedDoc {
  const payload = mapErrorPayload(doc.payload)
  return {
    table: 'app_error',
    row: {
      id: rowId(doc, 'app_error'),
      message: strOrNull(doc.message),
      stack: strOrNull(doc.stack),
      status_code: numOrNull(doc.statusCode),
      path: strOrNull(doc.path),
      method: strOrNull(doc.method),
      headers: doc.headers === undefined ? {} : doc.headers,
      payload: payload.payload,
      raw_payload: payload.rawPayload,
      error_type: strOrNull(doc.errorType),
      user_id: refUuidOrNull(doc.userId, 'app_error.userId'),
      response_code: strOrNull(doc.responseCode),
      response_msg: strOrNull(doc.responseMsg),
      ip: strOrNull(doc.ip),
      env: strOrNull(doc.env),
      created_at: reqTs(doc.createdAt, 'app_error.createdAt'),
    },
  }
}

function mapAppKey(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'app_key',
    row: {
      id: rowId(doc, 'app_key'),
      key: reqStr(doc.key, 'app_key.key'),
      type: reqStr(doc.type, 'app_key.type'),
      version: reqNum(doc.version, 'app_key.version'),
      status: strOr(doc.status, 'ACTIVE'),
      valid_start: reqTs(doc.validStart, 'app_key.validStart'),
      valid_end: tsOrNull(doc.validEnd),
      rotate_after: tsOrNull(doc.rotateAfter),
      meta: doc.meta === undefined ? null : doc.meta,
      ...commonTimestamps(doc),
    },
  }
}

function mapAuthRefreshToken(doc: Record<string, unknown>): MappedDoc {
  return {
    table: 'auth_refresh_token',
    row: {
      id: rowId(doc, 'auth_refresh_token'),
      jti: reqStr(doc.jti, 'auth_refresh_token.jti'),
      user_id: refUuid(doc.userId, 'auth_refresh_token.userId'),
      device_id: reqStr(doc.deviceId, 'auth_refresh_token.deviceId'),
      encrypted_token: reqStr(doc.encryptedToken, 'auth_refresh_token.encryptedToken'),
      expired_at: reqTs(doc.expiredAt, 'auth_refresh_token.expiredAt'),
      revoked: boolOr(doc.revoked, false),
      revoke_reason: strOrNull(doc.revokeReason),
      created_at: reqTs(doc.createdAt, 'auth_refresh_token.createdAt'),
    },
  }
}

function sub(value: unknown, field: string): Record<string, unknown> | null {
  if (value === null || value === undefined)
    return null
  if (typeof value !== 'object' || Array.isArray(value))
    throw new ViolationError(`${field} 不是对象：${String(value)}`)
  return value as Record<string, unknown>
}

/**
 * 全部集合 mapper。键 = Mongo 集合名（与 PG 表名同名）；
 * `Object.keys` 的顺序即**装载顺序**（FK 父表在前：lang→locale、dict_type→dict_data、
 * menu→role→user（role junction 挂 menu、user junction 挂 role）、device→user_device、
 * user→identity/…）。
 */
export const ETL_MAPPERS: Record<string, CollectionMapper> = {
  sys_lang: mapSysLang,
  sys_locale: mapSysLocale,
  sys_dict_type: mapSysDictType,
  sys_dict_data: mapSysDictData,
  sys_menu: mapSysMenu,
  sys_role: mapSysRole,
  sys_user: mapSysUser,
  sys_device: mapSysDevice,
  sys_user_device: mapSysUserDevice,
  sys_user_identity: mapSysUserIdentity,
  sys_user_lock: mapSysUserLock,
  sys_user_mfa: mapSysUserMfa,
  sys_user_oauth: mapSysUserOauth,
  sys_user_preference: mapSysUserPreference,
  sys_log_auth: mapSysLogAuth,
  sys_log_operate: mapSysLogOperate,
  sys_deleted: mapSysDeleted,
  shared_area: mapSharedArea,
  app_setting: mapAppSetting,
  app_demo: mapAppDemo,
  app_monitor_user: mapAppMonitorUser,
  app_error: mapAppError,
  app_key: mapAppKey,
  auth_refresh_token: mapAuthRefreshToken,
}

/** 集合装载顺序（同 ETL_MAPPERS 的键序，显式列出供对账与 truncate 复用） */
export const ETL_COLLECTION_ORDER: readonly string[] = Object.keys(ETL_MAPPERS)

/** junction 表 → 复合冲突目标（ON CONFLICT 子句用；业务表统一 `(id)`） */
export const JUNCTION_CONFLICT_TARGETS: Record<string, string> = {
  sys_user_role: '(user_id, role_id)',
  sys_role_menu: '(role_id, menu_id)',
}

/**
 * 各表 jsonb 列 —— **写入边界**要用：node-pg 把 JS 数组序列化成 **PG 数组字面量**，
 * 对 jsonb 列就是 "invalid input syntax for type json"（location_history 实测踩中）。
 * 行对象里保持原生 JS 值（对账要拿它跟 PG 反回来的对象深比），只在绑参数前 stringify。
 */
export const JSONB_COLUMNS: Record<string, ReadonlySet<string>> = {
  sys_menu: new Set(['watermark']),
  sys_device: new Set(['device_info', 'hardware_info', 'location_info', 'location_history']),
  sys_user_identity: new Set(['metadata']),
  sys_user_lock: new Set(['lock_route']),
  sys_user_preference: new Set(['layout']),
  sys_log_operate: new Set(['request_data', 'response_data', 'snapshot_before', 'snapshot_after']),
  sys_deleted: new Set(['content']),
  app_demo: new Set(['demo_object']),
  app_error: new Set(['headers', 'payload']),
  app_key: new Set(['meta']),
}

/** 这张表的这列是不是 jsonb（未登记的表/列一律 false，INSERT 构造处的防呆也用它） */
export function isJsonbColumn(table: string, col: string): boolean {
  return JSONB_COLUMNS[table]?.has(col) ?? false
}

/** 绑参数前的最后一步：jsonb 列的对象/数组 → JSON 文本（null 与标量原样） */
export function preparePgParam(table: string, col: string, value: unknown): unknown {
  if (!isJsonbColumn(table, col))
    return value
  if (value !== null && typeof value === 'object')
    return JSON.stringify(value)
  return value
}

/** 全部业务表（24 集合 + 2 junction）—— `--fresh` 的 TRUNCATE 清单与对账清单 */
export const ALL_BUSINESS_TABLES: readonly string[] = [
  ...ETL_COLLECTION_ORDER,
  ...Object.keys(JUNCTION_CONFLICT_TARGETS),
]

/**
 * sys_menu 的装载序整理：pid 自引用 FK 要求**父行先于子行**入库，而 Mongo 的自然序
 * （`_id` 升）不保证这一点。按 pid 链算深度后稳定排序；成环 / pid 指向不存在的行直接抛
 * （fail-closed —— 递归 CTE 的环保护是查询侧兜底，不是数据脏的借口，phase2 5.1 同口径）。
 * 返回新数组，不改原序入参。
 */
export function sortMenuRowsByDepth(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>()
  for (const row of rows)
    byId.set(String(row.id), row)

  const depthCache = new Map<string, number>()

  const depthOf = (id: string, path: ReadonlySet<string>): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined)
      return cached
    const row = byId.get(id)
    if (row === undefined)
      throw new ViolationError(`sys_menu 的 pid 指向不存在的节点：${id} —— 先修数据再搬`)
    const pid = row.pid
    if (pid === null || pid === undefined) {
      depthCache.set(id, 0)
      return 0
    }
    const pidKey = String(pid)
    if (path.has(pidKey))
      throw new ViolationError(`sys_menu 的 pid 链成环：${[...path, pidKey].join(' -> ')} —— 先修数据再搬`)
    const depth = 1 + depthOf(pidKey, new Set([...path, pidKey]))
    depthCache.set(id, depth)
    return depth
  }

  return [...rows]
    .map((row, index) => ({ row, index, depth: depthOf(String(row.id), new Set([String(row.id)])) }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map(entry => entry.row)
}
