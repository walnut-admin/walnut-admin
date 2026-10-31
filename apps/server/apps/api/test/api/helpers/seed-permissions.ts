import type { NestExpressApplication } from '@nestjs/platform-express'
import type { IWalnutAdminConstRoleMode } from '@walnut-server/const/role'
import type { DataSource } from 'typeorm'
import type { WalnutApiClient } from './api-client'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'

import { SysUserSharedService } from '@walnut-server/identity'
import { AuthOpaqueCoreService } from '@/modules/auth/modules/opaque/core/opaque.core.service'

import { WALNUT_DEFAULT_VISITOR_ROLE_UUID } from './auth-login'

/**
 * 种子参考数据层（真实权限链路 API 测试的 fixture）。
 *
 * 权限串的推导依据（读实现钉形，非猜测）：
 * - `menu.shared.service.ts getStrings` —— 权限串 = 菜单行 `permission` 列（meta 拍平列，
 *   `*:*:*` 形态），**一行一串**，过滤判据仅 `Boolean(meta.permission)`（element 行不进菜单树
 *   但进权限串）；因此「两个权限点」= 两根 element 菜单行，而不是一行的两个字段。
 * - `role.shared.service.ts getCoreMenus` —— 非 root 用户可用菜单 = 角色的
 *   `menusList`（sys_role_menu junction，`menu.status=true` 过滤）；effective
 *   roleMode 由 `app.functional.role` 设置经 scopeResolver 决定 —— 集成库 app_setting 空表时
 *   走默认值（scope GLOBAL / globalValue switchable）→ **恒取 `[currentRole]` 单角色**；
 *   scope LOCAL 时才回落用户自身 roleMode（SWITCH/COMBINE 对照用例据此改写 APP:SETTING 缓存）。
 * - `permission.guard.ts` —— 非 root 判定只认缓存 `AUTH:PERMISSIONS:<userId>:<deviceId>`
 *   （`GET /auth/permissions` 写入；缓存缺失直接 40105，无懒重建），命中后
 *   `allPermissions.includes(权限点)` 精确全串匹配。
 *
 * 种子形态（全部行带 seed 片段标记，`mark` = uuid 前 8 位）：
 * - 菜单：一根 pid=NULL 的 CATALOG 根（`getCorePermissions(ALL)` 在 sys_menu 无根行时
 *   `permissionMenuTree[0].children` TypeError → 50000，见 ENDPOINTS.md D 段补记 —— 根行必须种）
 *   + 每个权限点一根 element 子行（permission 列即权限串，不进菜单树只进权限串）；
 *   根行**不挂 junction** —— 非 root 链路里它由 `findAllRootMenus()` 兜底进入 menuArr，
 *   挂了反而和 findAllRootMenus 的返回值重复。
 * - 角色：role_status 默认 true 的普通角色（COMBINE 值读 `WalnutAdminConstRoleMode.COMBINE`，
 *   junction 三态与 role.api-spec C 段同款直插 sys_role_menu）；可选第二角色承载
 *   `secondRolePermissions`（SWITCH 对照用：junction 挂用户但不挂 current_role_id）。
 * - 用户：opaque **真实注册链**（@serenity-kit/opaque 客户端流 → 服务真实 crypto 栈
 *   `AuthOpaqueCoreService.finishRegister` 落 user + password identity 两腿，
 *   `registerRootUserFixture` 同款手法，仅角色不同）+ junction 挂种子角色
 *   （visitor 兜底 junction 删除，与 root fixture 同理对齐 AT payload）+
 *   `mfa_setup = true` / `role_mode` / `current_role_id` 直写（AT payload 登录时固化）。
 *
 * 设计原则：**不进 globalSetup** —— 集成库级重建已由 global-setup 承担，业务数据零预置是
 * 既有 34 份 spec 的自清假设；本种子由新 spec 的 beforeAll 调用、afterAll 按 mark 清理，
 * 「每次初始化」= 库级重建 + 本 spec 种子自洽。
 */

export interface SeedPermissionChainOptions {
  /** 用户名/角色名/菜单名前缀（会再拼 seed 片段保证全库唯一） */
  userNamePrefix: string
  /** 用户 role_mode（AT payload 固化值；SWITCH 对照第二腿由调用方 UPDATE 后重新登录） */
  roleMode?: IWalnutAdminConstRoleMode
  /** 授予的权限串：每串一根 element 菜单行，junction 挂主角色（current_role_id 指向它） */
  grantedPermissions: string[]
  /** 未授予的权限串：只进返回值供断言，不建任何行 */
  deniedPermissions?: string[]
  /** 第二角色承载的权限串（junction 挂用户、不挂 current —— SWITCH/COMBINE 对照用） */
  secondRolePermissions?: string[]
  /**
   * 主角色的数据权限档位（`sys_role.data_scope`，二期六档：
   * 1=ALL 2=CUSTOM 3=DEPT 4=DEPT_AND_CHILD 5=SELF 6=DEPT_OR_SELF）。
   * 缺省 1：既有用例都是「非 root 管理员能看全部业务数据」的语义，不能被数据权限改变。
   */
  dataScope?: number
  /** 用户所属部门（`sys_user.dept_id`；数据权限二期批 1 的 DEPT 系档位输入） */
  deptId?: string | null
}

export interface SeedPermissionChainFixture {
  /** seed 片段标记（菜单 name / 角色 role_name / 用户名共享），缓存与行清理按它匹配 */
  seedMark: string
  userId: string
  userName: string
  password: string
  /** 主角色（current_role_id 指向；SWITCH 模式下 effective 唯一角色） */
  mainRoleId: string
  /** 第二角色 id（未种第二角色时为 null） */
  secondRoleId: string | null
  /** 本种子建的全部菜单行 id（element 子行在前、CATALOG 根在最后 —— pid FK RESTRICT 清理序） */
  menuIds: string[]
  grantedPermissions: string[]
  deniedPermissions: string[]
  secondRolePermissions: string[]
}

/**
 * 种一个「非 root 用户 + 种子角色 + 最小菜单树」的自洽权限链路 fixture。
 * 全部直插 PG（集成库 migrations 只建结构，无业务数据）；注册走服务真实 opaque crypto 栈。
 */
export async function seedPermissionChainUser(
  app: NestExpressApplication,
  pgDataSource: DataSource,
  options: SeedPermissionChainOptions,
): Promise<SeedPermissionChainFixture> {
  const configService = app.get(ConfigService)
  const opaqueCore = app.get(AuthOpaqueCoreService)
  const userShared = app.get(SysUserSharedService)

  const seedMark = randomUUID().slice(0, 8)
  const userName = `${options.userNamePrefix}-${seedMark}`
  const password = `Pwd-${randomUUID().slice(0, 12)}#42`
  const roleMode = options.roleMode ?? WalnutAdminConstRoleMode.COMBINE

  // —— opaque 真实注册链（registerRootUserFixture 同款：identifiers 双端一致，
  //    serverSetup/app.name 与服务同源配置；createForAuthUser 落 user，finishRegister
  //    按 P1-14 语义补挂 password identity）——
  const appName = configService.get<string>('app.name')!
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
  const registrationResponse = await opaqueCore.startRegister(userName, registrationRequest)
  const { registrationRecord } = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { client: userName, server: appName },
  })

  // createForAuthUser 给 junction 写 visitor 兜底 role uuid —— 先确保该行存在（FK）
  await pgDataSource.query(
    'INSERT INTO sys_role (id, role_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
    [WALNUT_DEFAULT_VISITOR_ROLE_UUID, `${options.userNamePrefix}-visitor-${seedMark}`],
  )
  const newUser = await userShared.createForAuthUser({ userName }, pgDataSource.manager)
  await opaqueCore.finishRegister(newUser.id, registrationRecord, pgDataSource.manager)

  const userId = newUser.id

  // —— 最小菜单树：CATALOG 根（pid=NULL，不挂 junction，非 root 链路由 findAllRootMenus 兜底）
  //    + 每个权限点一根 element 子行（permission 列 = 权限串，一行一串）——
  const rootMenuRows: Array<{ id: string }> = await pgDataSource.query(
    `INSERT INTO sys_menu (pid, type, path, name, title, sort_order)
     VALUES (NULL, 'catalog', NULL, $1, $2, 0) RETURNING id`,
    [`${options.userNamePrefix}-root-${seedMark}`, `menu.title.seed.${seedMark}.root`],
  )
  const rootMenuId = rootMenuRows[0].id

  async function seedElementMenu(permission: string, order: number): Promise<string> {
    const rows: Array<{ id: string }> = await pgDataSource.query(
      `INSERT INTO sys_menu (pid, type, name, title, sort_order, permission)
       VALUES ($1, 'element', $2, $3, $4, $5) RETURNING id`,
      [rootMenuId, `${options.userNamePrefix}-p${order}-${seedMark}`, `menu.title.seed.${seedMark}.p${order}`, order, permission],
    )
    return rows[0].id
  }

  const grantedMenuIds: string[] = []
  for (let i = 0; i < options.grantedPermissions.length; i++) {
    grantedMenuIds.push(await seedElementMenu(options.grantedPermissions[i], i + 1))
  }

  const secondMenuIds: string[] = []
  const secondPermissions = options.secondRolePermissions ?? []
  for (let i = 0; i < secondPermissions.length; i++) {
    secondMenuIds.push(await seedElementMenu(secondPermissions[i], options.grantedPermissions.length + i + 1))
  }

  // —— 种子角色 + junction（role_name 全库唯一；status 默认 true —— populate 过滤条件）——
  const mainRoleRows: Array<{ id: string }> = await pgDataSource.query(
    'INSERT INTO sys_role (role_name, description, data_scope) VALUES ($1, $2, $3) RETURNING id',
    [`${options.userNamePrefix}-main-${seedMark}`, `seed main role ${seedMark}`, options.dataScope ?? 1],
  )
  const mainRoleId = mainRoleRows[0].id
  for (const menuId of grantedMenuIds) {
    await pgDataSource.query(
      'INSERT INTO sys_role_menu (role_id, menu_id) VALUES ($1, $2)',
      [mainRoleId, menuId],
    )
  }

  let secondRoleId: string | null = null
  if (secondMenuIds.length > 0) {
    const secondRoleRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_role (role_name, description) VALUES ($1, $2) RETURNING id',
      [`${options.userNamePrefix}-second-${seedMark}`, `seed second role ${seedMark}`],
    )
    secondRoleId = secondRoleRows[0].id
    for (const menuId of secondMenuIds) {
      await pgDataSource.query(
        'INSERT INTO sys_role_menu (role_id, menu_id) VALUES ($1, $2)',
        [secondRoleId, menuId],
      )
    }
  }

  // —— 用户 ↔ 角色 junction（visitor 兜底 junction 删除，AT payload 的 roleNames 才干净）+
  //    mfa_setup / role_mode / current_role_id 直写（登录时固化进 AT payload）——
  await pgDataSource.query(
    'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
    [userId, mainRoleId],
  )
  if (secondRoleId !== null) {
    await pgDataSource.query(
      'INSERT INTO sys_user_role (user_id, role_id) VALUES ($1, $2)',
      [userId, secondRoleId],
    )
  }
  const keepRoleIds = secondRoleId === null ? [mainRoleId] : [mainRoleId, secondRoleId]
  await pgDataSource.query(
    'DELETE FROM sys_user_role WHERE user_id = $1 AND role_id <> ALL($2::uuid[])',
    [userId, keepRoleIds],
  )
  await pgDataSource.query(
    'UPDATE sys_user SET mfa_setup = true, role_mode = $2, current_role_id = $3, dept_id = $4 WHERE id = $1',
    [userId, roleMode, mainRoleId, options.deptId ?? null],
  )

  return {
    seedMark,
    userId,
    userName,
    password,
    mainRoleId,
    secondRoleId,
    menuIds: [...grantedMenuIds, ...secondMenuIds, rootMenuId],
    grantedPermissions: [...options.grantedPermissions],
    deniedPermissions: [...(options.deniedPermissions ?? [])],
    secondRolePermissions: [...secondPermissions],
  }
}

/**
 * 种子清理（spec afterAll 调用）：PG 行按 FK 依赖序删（user 级联 junction/identity，
 * role 级联 sys_role_menu，element 子行先于 CATALOG 根 —— pid FK RESTRICT）；
 * 设备行与 `WALNUT_CACHE_*` 键（会话/签名/MFA verified/权限缓存，按 seed 片段与
 * userId/deviceId 匹配）一并收口。
 */
export async function cleanupPermissionChainSeed(
  api: WalnutApiClient,
  fixtures: SeedPermissionChainFixture[],
  deviceIds: string[],
): Promise<void> {
  const fragments = new Set<string>(deviceIds)

  for (const fixture of fixtures) {
    await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
    const roleIds = fixture.secondRoleId === null ? [fixture.mainRoleId] : [fixture.mainRoleId, fixture.secondRoleId]
    await api.pgDataSource.query('DELETE FROM sys_role WHERE id = ANY($1::uuid[])', [roleIds])
    // pid FK RESTRICT：element 子行（pid = 根 id）先删，CATALOG 根后删
    const rootId = fixture.menuIds[fixture.menuIds.length - 1]
    await api.pgDataSource.query('DELETE FROM sys_menu WHERE pid = $1', [rootId])
    await api.pgDataSource.query('DELETE FROM sys_menu WHERE id = $1', [rootId])
    fragments.add(fixture.seedMark)
    fragments.add(fixture.userId)
  }

  if (deviceIds.length > 0) {
    await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [deviceIds])
  }

  await api.cleanupWalnutCacheKeys(...fragments)
}
