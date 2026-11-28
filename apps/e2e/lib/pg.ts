/**
 * E2E 的 PG 直连（**管理通道**：与 seed / 迁移同角色）。
 *
 * 用途分两类：
 * - 断言：`sys_device` 行是否存在、字段是否被 backfill（created_at）、是否 banned/locked；
 * - fixture：U9 删设备行、新设备用例把 created_at 回填到 1 小时前 / 3 天前。
 *
 * 安全闸：连接参数只从 scripts/env.ts 来（库名按当前 stack profile：`walnut_e2e` 或
 * `walnut_e2e_<profile>`），并在建连前过 assertE2eDatabase / assertE2ePgPort —— 这些 helper
 * 会 DELETE / UPDATE，指错库就是事故。
 */
import type { ClientConfig } from 'pg'
import { Client } from 'pg'
import {
  assertE2eDatabase,
  assertE2ePgPort,
  E2E_PG_DB,
  E2E_PG_HOST,
  E2E_PG_PASS,
  E2E_PG_PORT,
  E2E_PG_USER,
} from '../scripts/env.ts'

export interface SysDeviceRow {
  id: string
  device_id: string
  device_name: string
  ip: string | null
  active: boolean
  locked: boolean
  banned: boolean
  private: boolean
  stale: boolean
  risk_score: number
  created_at: Date
  updated_at: Date
}

/**
 * 本机回环的两种写法：Node 服务监听在双栈 `::` 上时，127.0.0.1 的对端会被 Express 读成
 * `::ffff:127.0.0.1`（IPv4-mapped）。这不是配置错误 —— `is-localhost-ip` 两种都判 true
 * （走 getLocalLocation、零外网）。断言用这个正则，别写死单一形态。
 */
export const LOOPBACK_IP_PATTERN = /^(::ffff:)?127(?:\.\d{1,3}){3}$/

/** 结构化定位（用于断言 LOCAL 路径 / 真实外网定位） */
export async function findDeviceLocation(
  client: Client,
  deviceId: string,
): Promise<{
  ip: string | null
  country: string | null
  latitude: number | null
  longitude: number | null
} | null> {
  const { rows } = await client.query<{
    ip: string | null
    location_info: { country?: string } | null
    geo_latitude: number | null
    geo_longitude: number | null
  }>('SELECT ip, location_info, geo_latitude, geo_longitude FROM sys_device WHERE device_id = $1', [
    deviceId,
  ])

  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return {
    ip: row.ip,
    country: row.location_info?.country ?? null,
    latitude: row.geo_latitude,
    longitude: row.geo_longitude,
  }
}

const pgConfig: ClientConfig = {
  host: E2E_PG_HOST,
  port: E2E_PG_PORT,
  user: E2E_PG_USER,
  password: E2E_PG_PASS,
  database: E2E_PG_DB,
}

/**
 * 建一个到**当前 profile 的 E2E 库**的连接（调用方负责 end()；setup/spec 里用 withPg 更省事）。
 *
 * 安全闸分两层：连之前的 `assert*` 在实参来自常量时是**恒真的机械标记**（防将来把常量换成
 * 字面量）；连上之后的 `SELECT current_database()` 才是对**运行态**的断言 —— 端口 / 库名
 * 如果被 env 或代理改到别处，这里当场发现（这些 helper 会 DELETE / UPDATE，指错库就是事故）。
 */
async function connectPg(): Promise<Client> {
  assertE2eDatabase(pgConfig.database as string)
  assertE2ePgPort(pgConfig.port as number)
  const client = new Client(pgConfig)
  await client.connect()

  const { rows } = await client.query<{ database: string }>('SELECT current_database() AS database')
  const actual = rows[0]?.database
  if (actual !== E2E_PG_DB) {
    await client.end().catch(() => {})
    throw new Error(
      `[e2e/safety] 连接落在库 \`${actual}\` 上（期望 \`${E2E_PG_DB}\`）—— 拒绝执行：本连接会 DELETE / UPDATE`,
    )
  }

  return client
}

/** 用完自动 end 的包装 */
export async function withPg<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = await connectPg()
  try {
    return await run(client)
  } finally {
    await client.end()
  }
}

export async function findDeviceRow(
  client: Client,
  deviceId: string,
): Promise<SysDeviceRow | null> {
  const { rows } = await client.query<SysDeviceRow>(
    `SELECT id, device_id, device_name, ip, active, locked, banned, private, stale, risk_score, created_at, updated_at
       FROM sys_device WHERE device_id = $1`,
    [deviceId],
  )
  return rows[0] ?? null
}

/** U9：删设备行（user_device / auth_refresh_token 的 FK 都是 ON DELETE CASCADE） */
export async function deleteDeviceRow(client: Client, deviceId: string): Promise<number> {
  const result = await client.query('DELETE FROM sys_device WHERE device_id = $1', [deviceId])
  return result.rowCount ?? 0
}

/**
 * 新设备 / 最近设备用例：把 created_at 回填到 N 毫秒前。
 *
 * 注意 **`updated_at` 不动**（TypeORM 的 UpdateDateColumn 只在 ORM 写时维护，裸 SQL 不回填）；
 * risk 的判据只看 createdAt（device.service 的 getDeviceCreatedDays）。
 */
export async function backdateDeviceCreatedAt(
  client: Client,
  deviceId: string,
  msAgo: number,
): Promise<void> {
  await client.query(
    `UPDATE sys_device SET created_at = now() - ($2::bigint * interval '1 millisecond') WHERE device_id = $1`,
    [deviceId, msAgo],
  )
}

/**
 * 「登出」的服务端一半：**删除**该设备上的 refresh token 行。
 *
 * 为什么必须做：部分唯一索引 `uq_rt_active_device_user` 不允许同设备同用户存在两条 active RT，
 * 登录链会把它翻译成受控 40109「重复认证」。只清浏览器侧 token 的「假登出」会让第二次登录
 * 在 login/finish 撞 40109。
 *
 * 用 DELETE 而不是 UPDATE revoked：`ck_refresh_token_revoke_reason` 的枚举里没有「登出」这一
 * 原因（那是产品侧枚举），fixture 不该为它编造一个业务原因；按设备删除是精确且干净的。
 */
export async function clearRefreshTokensForDevice(
  client: Client,
  deviceId: string,
): Promise<number> {
  const result = await client.query('DELETE FROM auth_refresh_token WHERE device_id = $1', [
    deviceId,
  ])
  return result.rowCount ?? 0
}

/** 按 userName 取 userId（U14 / U15 的 `sys_user_device` 行按 (user_id, device_id) 定位） */
export async function findUserIdByUserName(client: Client, userName: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM sys_user WHERE user_name = $1',
    [userName],
  )
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error(`[e2e/pg] sys_user 没有 user_name = ${userName} 的行`)
  }
  return id
}

export interface SysUserDeviceRow {
  userId: string
  deviceId: string
  trusted: boolean
  trustedExpiredAt: Date | null
  locked: boolean
  lastActiveAt: Date | null
}

/** 读 `sys_user_device` 行（U14 / U15 的 DB 唯一判据：trusted + trusted_expired_at） */
export async function findUserDeviceRow(
  client: Client,
  userId: string,
  deviceId: string,
): Promise<SysUserDeviceRow | null> {
  const { rows } = await client.query<{
    user_id: string
    device_id: string
    trusted: boolean
    trusted_expired_at: Date | null
    locked: boolean
    last_active_at: Date | null
  }>(
    `SELECT user_id, device_id, trusted, trusted_expired_at, locked, last_active_at
       FROM sys_user_device WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId],
  )
  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return {
    userId: row.user_id,
    deviceId: row.device_id,
    trusted: row.trusted,
    trustedExpiredAt: row.trusted_expired_at,
    locked: row.locked,
    lastActiveAt: row.last_active_at,
  }
}

export interface SysUserLockRow {
  lockMode: string
  lockIdleSec: number
  lockSecuritySec: number
  lockCrossDevice: boolean
  lockPwdHash: string | null
  lockPwdFailCount: number
  lockPwdLockedUntil: Date | null
}

/**
 * 读 `sys_user_lock` 偏好行（L2 锁屏闭环用例的唯一真源）。
 *
 * `lockPwdHash` 只在测试侧读取（断言它是 bcrypt 哈希而非明文）；生产响应永远不回列
 * （`GET lock/read` 只回 `lockPwdSet`）。
 */
export async function findUserLockRow(
  client: Client,
  userId: string,
): Promise<SysUserLockRow | null> {
  const { rows } = await client.query<{
    lock_mode: string
    lock_idle_sec: number
    lock_security_sec: number
    lock_cross_device: boolean
    lock_pwd_hash: string | null
    lock_pwd_fail_count: number
    lock_pwd_locked_until: Date | null
  }>(
    `SELECT lock_mode, lock_idle_sec, lock_security_sec, lock_cross_device,
            lock_pwd_hash, lock_pwd_fail_count, lock_pwd_locked_until
       FROM sys_user_lock WHERE user_id = $1`,
    [userId],
  )
  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return {
    lockMode: row.lock_mode,
    lockIdleSec: row.lock_idle_sec,
    lockSecuritySec: row.lock_security_sec,
    lockCrossDevice: row.lock_cross_device,
    lockPwdHash: row.lock_pwd_hash,
    lockPwdFailCount: row.lock_pwd_fail_count,
    lockPwdLockedUntil: row.lock_pwd_locked_until,
  }
}

/**
 * 把锁屏退避截止**回填到过去**（测试侧的时钟注入，替代「等 30s」）。
 *
 * 为什么不再按 DB 时钟轮询到期：`lock_pwd_locked_until` 由服务端 **Node 时钟**写入，
 * 服务端判定退避是否结束也用 Node 时钟；E2E 的 PG 跑在 WSL、后端跑在 Windows，两钟不同源
 * （R-D 实测摆动 −0.8s ~ +1.8s）。按 DB `now()` 等到期后立刻提交，若 DB 比 Node 快，请求会
 * 落进服务端仍视为退避的尾窗（`Math.ceil` 还会把 <1s 放大成 1s）→ 40000 假红。
 *
 * 这里直接把截止拨到 30s 前 —— 远超观测到的时钟摆动，让两侧时钟都判「已过期」；退避曲线
 * 本身由第 5 次失败的 `meta.retryAfterSec` 断言与 `lock-pwd-backoff` 单测覆盖，不靠等待证明。
 * 回填后调用方必须 reload：客户端倒计时是组件本地 ref，归零后提交按钮才可用。
 *
 * @returns 受影响行数（调用方断言为 1，防止 userId 写错时静默通过）
 */
export async function expireLockBackoff(client: Client, userId: string): Promise<number> {
  const result = await client.query(
    `UPDATE sys_user_lock SET lock_pwd_locked_until = now() - interval '30 seconds' WHERE user_id = $1`,
    [userId],
  )
  return result.rowCount ?? 0
}

/** 管理员重置锁屏的审计行数（operation=`user.lock.reset`；url 里带被重置的 userId） */
export async function countLockResetAuditRows(client: Client, userId: string): Promise<number> {
  const { rows } = await client.query<{ c: number }>(
    `SELECT count(*)::int AS c FROM sys_log_operate
      WHERE operation = 'user.lock.reset' AND success = true AND url LIKE '%' || $1 || '%'`,
    [userId],
  )
  return rows[0]?.c ?? 0
}

/**
 * U15：把 `sys_user_device.trusted_expired_at` 回填到 N 毫秒前。
 *
 * 只改这一列：`trusted` 保持 true —— 这样风险判定走的是「已信任但过期」
 * （USER_DEVICE_TRUST_EXPIRED），而不是「未信任」（USER_DEVICE_UNTRUSTED）。
 */
export async function backdateUserDeviceTrustExpiredAt(
  client: Client,
  userId: string,
  deviceId: string,
  msAgo: number,
): Promise<number> {
  const result = await client.query(
    `UPDATE sys_user_device SET trusted_expired_at = now() - ($3::bigint * interval '1 millisecond')
      WHERE user_id = $1 AND device_id = $2`,
    [userId, deviceId, msAgo],
  )
  return result.rowCount ?? 0
}

/** U15 的负对照：把 `trusted_expired_at` 拨回将来（同一列、同一行，只翻转过期方向） */
export async function setUserDeviceTrustExpiredAt(
  client: Client,
  userId: string,
  deviceId: string,
  at: Date,
): Promise<number> {
  const result = await client.query(
    'UPDATE sys_user_device SET trusted_expired_at = $3 WHERE user_id = $1 AND device_id = $2',
    [userId, deviceId, at],
  )
  return result.rowCount ?? 0
}

/** `app_setting` 的永久 IP 黑名单键（服务端 `WalnutAdminConstAppSettingKeys.APP_GLOBAL_IP_BLACKLIST`，键名逐字） */
export const APP_SETTING_KEY_IP_BLACKLIST = 'app.global.ipBlackList'

/** 读某条 app_setting 的原始 `setting_value`（不存在返回 null） */
export async function readAppSettingValue(client: Client, key: string): Promise<string | null> {
  const { rows } = await client.query<{ setting_value: string }>(
    'SELECT setting_value FROM app_setting WHERE setting_key = $1',
    [key],
  )
  return rows[0]?.setting_value ?? null
}

/** 写某条 app_setting 的 `setting_value`（U11 造永久黑名单；改完必须经 `POST /app/setting/cache/refresh` 让服务端读到） */
export async function updateAppSettingValue(
  client: Client,
  key: string,
  value: string,
): Promise<number> {
  const result = await client.query(
    'UPDATE app_setting SET setting_value = $2 WHERE setting_key = $1',
    [key, value],
  )
  return result.rowCount ?? 0
}

/** 读永久 IP 黑名单（JSON 数组） */
export async function readPermanentIpBlacklist(client: Client): Promise<string[]> {
  const raw = await readAppSettingValue(client, APP_SETTING_KEY_IP_BLACKLIST)
  return raw === null ? [] : (JSON.parse(raw) as string[])
}

/** 写永久 IP 黑名单（JSON 数组原样序列化，与服务端 `addToPermanentBlackList` 的落盘形态一致） */
export async function writePermanentIpBlacklist(client: Client, ips: string[]): Promise<number> {
  return updateAppSettingValue(client, APP_SETTING_KEY_IP_BLACKLIST, JSON.stringify(ips))
}

// ─── 模块 spec（菜单 / 角色 / 设置）与 auth 矩阵的断言 / fixture 通道 ────────────────

/** 按 `role_name` 取角色 id（列有 uq_role_name；seed 的 visitor / test-home 用它定位） */
export async function findRoleIdByName(client: Client, roleName: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM sys_role WHERE role_name = $1',
    [roleName],
  )
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error(`[e2e/pg] sys_role 没有 role_name = ${roleName} 的行`)
  }
  return id
}

/**
 * 按 `permission` 取某条 element 菜单的 id。
 *
 * 用途：角色授权用例要拿**真实菜单行**去挂 junction（权限串由菜单的 permission 列派生），
 * 用 seed 里的稳定权限串比新造菜单更干净 —— 新造行属于菜单 spec 的写路径。
 */
export async function findElementMenuIdByPermission(
  client: Client,
  permission: string,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    "SELECT id FROM sys_menu WHERE permission = $1 AND type = 'element' AND status = true ORDER BY sort_order LIMIT 1",
    [permission],
  )
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error(`[e2e/pg] sys_menu 没有 permission = ${permission} 的启用 element 行`)
  }
  return id
}

/**
 * 按 `name + type` 取菜单行 id（路由真源 = 库里的菜单）。
 *
 * 「菜单给、element 不给」的权限可见性用例要的正是**菜单行本身**（`type='menu'`，它没有
 * permission）与它的父 catalog：挂上这两行，`/auth/permissions` 就会把路由注册出来，而
 * 任何 element 权限串都不出现。
 */
export async function findMenuIdByName(
  client: Client,
  name: string,
  type: 'menu' | 'catalog' = 'menu',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM sys_menu WHERE name = $1 AND type = $2 ORDER BY sort_order LIMIT 1',
    [name, type],
  )
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error(`[e2e/pg] sys_menu 没有 name = ${name} / type = ${type} 的行`)
  }
  return id
}

/** 按 `path + type` 取菜单行 id（catalog 的 path 是相对段，例如 `system`） */
export async function findMenuIdByPath(
  client: Client,
  path: string,
  type: 'menu' | 'catalog' = 'catalog',
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM sys_menu WHERE path = $1 AND type = $2 ORDER BY sort_order LIMIT 1',
    [path, type],
  )
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error(`[e2e/pg] sys_menu 没有 path = ${path} / type = ${type} 的行`)
  }
  return id
}

/**
 * 取 seed 的根菜单 id（`pid IS NULL` 的第一行）。
 *
 * 菜单树端点按「**单一合成根**」实现：`fullTree.flatMap(root => root.children ?? [])` ——
 * 新造一个 `pid=NULL` 的根节点时，它自身不在返回的 fullTree 里（只有它的 children 会以顶层
 * 节点出现）。用例把新 catalog 挂到 seed 根下，既符合 admin 的真实数据形态，也让树的
 * 父子断言可观测。
 */
export async function findRootMenuId(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'SELECT id FROM sys_menu WHERE pid IS NULL ORDER BY sort_order LIMIT 1',
  )
  const id = rows[0]?.id
  if (id === undefined) {
    throw new Error('[e2e/pg] sys_menu 没有根菜单（pid IS NULL）')
  }
  return id
}

/** 读 `sys_user.mfa_setup`（auth 矩阵的账号级判据） */
export async function readUserMfaSetup(client: Client, userId: string): Promise<boolean> {
  const { rows } = await client.query<{ mfa_setup: boolean }>(
    'SELECT mfa_setup FROM sys_user WHERE id = $1',
    [userId],
  )
  const row = rows[0]
  if (row === undefined) {
    throw new Error(`[e2e/pg] sys_user 没有 id = ${userId} 的行`)
  }
  return row.mfa_setup
}

/**
 * 读某用户的 totp MFA 行（`backup_codes_ciphertext` 是 select:false 列，这里显式取长度）。
 *
 * 备用码是 10 枚一次性码：验证消费一枚后数组长度必须减一 —— 这是「一次性」唯一可回读的
 * 落点（服务端只存哈希后的密文，无法比对具体码值）。
 */
export async function findTotpMfaRow(
  client: Client,
  userId: string,
): Promise<{ id: string; deviceId: string; status: boolean; backupCodesLeft: number } | null> {
  const { rows } = await client.query<{
    id: string
    device_id: string
    status: boolean
    backup_codes_left: number
  }>(
    `SELECT id, device_id, status, coalesce(array_length(backup_codes_ciphertext, 1), 0)::int AS backup_codes_left
       FROM sys_user_mfa WHERE user_id = $1 AND type = 'totp'`,
    [userId],
  )
  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return {
    id: row.id,
    deviceId: row.device_id,
    status: row.status,
    backupCodesLeft: row.backup_codes_left,
  }
}

/** 数某设备上**仍现役**的 refresh token 行（踢下线 / 登出后必须为 0） */
export async function countActiveRefreshTokensForDevice(
  client: Client,
  deviceId: string,
): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM auth_refresh_token WHERE device_id = $1 AND revoked = false',
    [deviceId],
  )
  return rows[0]?.count ?? 0
}

/**
 * 插入一条 `app_monitor_user`（`DELETE /system/user/device/force-quit/:deviceId` 的前置）。
 *
 * 为什么需要：协议客户端不连 socket，而 monitor 行由 socket 的 auth-state 上报创建 ——
 * force-quit 服务按 `(userId, deviceId)` 查 monitor 行，缺行直接 40401。这里补的是
 * **真实运行态里 UI 设备会有的那条行**，不是伪造会话；踢下线链路的服务端行为全部真跑。
 */
export async function insertMonitorUserRow(
  client: Client,
  userId: string,
  deviceId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO app_monitor_user (visitor_id, user_id, device_id, auth, focus, is_left)
     VALUES ($1, $2, $3, true, true, false)`,
    [`e2e-${deviceId}-${Date.now()}`, userId, deviceId],
  )
}

/** 删某设备的 monitor 行（`app_monitor_user` 松引用、无 FK，fixture 必须自己收尾） */
export async function deleteMonitorUserByDeviceId(
  client: Client,
  deviceId: string,
): Promise<number> {
  const result = await client.query('DELETE FROM app_monitor_user WHERE device_id = $1', [deviceId])
  return result.rowCount ?? 0
}

/**
 * 读某设备的心跳行（`app_monitor_user`）。
 *
 * force-quit 的 socket 投递面按 `(userId, deviceId)` 查这行、再以行上的 `visitorId`
 * 定位房间（`forceQuitMonitorBySocket`）—— 浏览器设备只有在真实心跳上报之后才会收到
 * FORCE_QUIT。用例把它当**前置断言**：行不在 / auth=false / left=true 时，socket 段
 * 本来就不可能成立，失败原因要在前置处说清，而不是在等帧的地方超时。
 */
export async function findMonitorUserRow(
  client: Client,
  userId: string,
  deviceId: string,
): Promise<{ auth: boolean; left: boolean; visitorId: string } | null> {
  const { rows } = await client.query<{ auth: boolean; is_left: boolean; visitor_id: string }>(
    'SELECT auth, is_left, visitor_id FROM app_monitor_user WHERE user_id = $1 AND device_id = $2 ORDER BY last_active_at DESC LIMIT 1',
    [userId, deviceId],
  )
  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return { auth: row.auth, left: row.is_left, visitorId: row.visitor_id }
}

/**
 * 读某用户的 WebAuthn 凭据行（`sys_user_mfa.type = 'webauthn'`）。
 *
 * `webauthn_public_key` 是 select:false 列（AES 密文），这里显式取长度：注册成功后
 * 密文必须非空；`webauthn_credential_id` 与浏览器虚拟认证器里的 credentialId 同源
 * （simplewebauthn 的 base64url），`webauthn_counter` 在每次断言后递增（防重放）。
 */
export async function findWebauthnMfaRow(
  client: Client,
  userId: string,
): Promise<{
  id: string
  deviceId: string
  credentialId: string | null
  counter: number
  status: boolean
  publicKeyCiphertextLength: number
  lastUsedAt: Date | null
} | null> {
  const { rows } = await client.query<{
    id: string
    device_id: string
    webauthn_credential_id: string | null
    webauthn_counter: string | number
    status: boolean
    pk_len: number
    last_used_at: Date | null
  }>(
    `SELECT id, device_id, webauthn_credential_id, webauthn_counter, status,
            coalesce(length(webauthn_public_key), 0)::int AS pk_len, last_used_at
       FROM sys_user_mfa WHERE user_id = $1 AND type = 'webauthn'`,
    [userId],
  )
  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return {
    id: row.id,
    deviceId: row.device_id,
    credentialId: row.webauthn_credential_id,
    // bigint 列经 pg 驱动默认是 string（实体侧有 transformer，直连 SQL 没有）
    counter: Number(row.webauthn_counter),
    status: row.status,
    publicKeyCiphertextLength: row.pk_len,
    lastUsedAt: row.last_used_at,
  }
}

/** 硬删用户（按 userName；user_role / identity / user_device / RT 都是 CASCADE） */
export async function deleteUserByUserName(client: Client, userName: string): Promise<number> {
  const result = await client.query('DELETE FROM sys_user WHERE user_name = $1', [userName])
  return result.rowCount ?? 0
}

/** 硬删角色（sys_role_menu / sys_role_dept / sys_user_role 都是 CASCADE） */
export async function deleteRoleById(client: Client, roleId: string): Promise<number> {
  const result = await client.query('DELETE FROM sys_role WHERE id = $1', [roleId])
  return result.rowCount ?? 0
}

/** 硬删 app_setting 行（setting 模块**没有** delete 端点，用例收尾只能走这里） */
export async function deleteAppSettingByKey(client: Client, key: string): Promise<number> {
  const result = await client.query('DELETE FROM app_setting WHERE setting_key = $1', [key])
  return result.rowCount ?? 0
}

/** 数 `sys_deleted` 里某个被删主键的快照行（软删的审计落点） */
export async function countDeletedRows(client: Client, deletedId: string): Promise<number> {
  const { rows } = await client.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM sys_deleted WHERE deleted_id = $1',
    [deletedId],
  )
  return rows[0]?.count ?? 0
}

/**
 * 读 `sys_deleted` 里某个被删主键的快照行（恢复要 `id + deletedId` 双键；真删按 `id`）。
 *
 * `content` 是 jsonb 快照对象（恢复时原样插回原表），`model_name` 是恢复路由键
 * （`WalnutAdminRecoverableRegistry`）—— 回收站闭环断言「快照里存的是被删行本身」用它。
 */
export async function findDeletedRowByDeletedId(
  client: Client,
  deletedId: string,
): Promise<{
  id: string
  deletedId: string
  modelName: string
  collectionName: string
  deletedBy: string
  content: Record<string, unknown>
  deletedAt: Date | null
} | null> {
  const { rows } = await client.query<{
    id: string
    deleted_id: string
    model_name: string
    collection_name: string
    deleted_by: string
    content: Record<string, unknown>
    deleted_at: Date | null
  }>(
    `SELECT id, deleted_id, model_name, collection_name, deleted_by, content, deleted_at
       FROM sys_deleted WHERE deleted_id = $1 ORDER BY deleted_at DESC LIMIT 1`,
    [deletedId],
  )
  const row = rows[0]
  if (row === undefined) {
    return null
  }
  return {
    id: row.id,
    deletedId: row.deleted_id,
    modelName: row.model_name,
    collectionName: row.collection_name,
    deletedBy: row.deleted_by,
    content: row.content,
    deletedAt: row.deleted_at,
  }
}
