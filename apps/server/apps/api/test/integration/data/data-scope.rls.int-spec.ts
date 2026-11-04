import type { INestApplication } from '@nestjs/common'
import type { IWalnutAdminDataScopeRlsSettings } from '@walnut-server/db'
import type { DataSource, QueryRunner } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { applyWalnutDataScopeRlsSettings, WALNUT_DATA_SCOPE_RLS_MODE } from '@walnut-server/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource, getWalnutPgDataSource } from '../helpers/create-integration-app'

/**
 * 数据权限三期专项 —— **绕过应用层的直连 SQL 也必须被 RLS 拦住**。
 *
 * 这是 RLS 相对应用层 scope 的独有价值：应用层 scope 只覆盖基类仓库的查询
 * （list / readById / updateByField / delete*），漏一个 WHERE 或走一条直连 em 的
 * 查询就绕过了。RLS 在数据库层按事务设置（`app.data_scope.*`）再过一遍天花板，
 * 就算应用层写错，部门/本人之外的行也读不到、写不进。
 *
 * 用例形态：
 * - 运行时连接必须是 `walnut_app`（NOSUPERUSER NOBYPASSRLS、非表 owner），否则
 *   「全过」是假阳性（超级用户/owner 天然绕过 RLS）；
 * - 七张注册表都有 ENABLE + FORCE RLS + 一 PERMISSIVE + 一 RESTRICTIVE 策略；
 * - 事务内 set_config 后直接 `SELECT * FROM app_demo`（不经基类、不带任何 WHERE）
 *   → 只返回天花板内的行；
 * - 天花板外的 INSERT/UPDATE 撞策略报错（WITH CHECK）；
 * - anonymous 模式 0 行（fail-closed）；all/system 放行（root 与可信系统通道）。
 *
 * 行归属用**管理连接**（`DATABASE_PG_USER`，与迁移/导出同通道）直接造，不经 HTTP
 * 管理员登录；应用连接（walnut_app）只用于 RLS 探测 —— 池级无事务设置时缺省
 * `anonymous`，正好用来验证 fail-closed。
 */
describe('DataScope RLS (PostgreSQL row level security)', () => {
  let app: INestApplication
  /** 应用连接（walnut_app）：所有 RLS 探测都用它 */
  let pgDataSource: DataSource
  /** 管理连接：fixture / 清理（运维通道，天然绕 RLS） */
  let adminPgDataSource: DataSource

  const prefix = `rls-${randomUUID().slice(0, 8)}`
  const userA = randomUUID()
  const userB = randomUUID()

  let deptA: string
  let deptB: string

  const REGISTERED_TABLES = [
    'sys_user',
    'sys_log_operate',
    'sys_log_auth',
    'app_monitor_user',
    'sys_deleted',
    'app_demo',
    'sys_employee',
  ]

  function demoPayload(name: string, owner: string | null, deptId: string | null) {
    const seed = randomUUID()

    return {
      demoString: `${prefix}-${name}`,
      demoPhoneNumber: `139${seed.replaceAll('-', '').slice(0, 11)}`,
      demoStringArray: [`v-${seed}`],
      demoNumberArray: [1, 2],
      demoBooleanArray: [true],
      demoDateArray: [new Date('2026-01-01T00:00:00Z')],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [seed],
      createdBy: owner,
      deptId,
    }
  }

  /** 测试 fixture：管理连接写入（运维通道，绕 RLS） */
  async function insertDemo(name: string, owner: string | null, deptId: string | null): Promise<string> {
    const payload = demoPayload(name, owner, deptId)
    const rows: Array<{ id: string }> = await adminPgDataSource.query(
      `INSERT INTO app_demo
        (demo_string, demo_phone_number, demo_string_array, demo_number_array, demo_boolean_array,
         demo_date_array, demo_enum_array, demo_uuid_array, created_by, dept_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        payload.demoString,
        payload.demoPhoneNumber,
        payload.demoStringArray,
        payload.demoNumberArray,
        payload.demoBooleanArray,
        payload.demoDateArray,
        payload.demoEnumArray,
        payload.demoMongoIdArray,
        payload.createdBy,
        payload.deptId,
      ],
    )

    return rows[0].id
  }

  /** 在「与业务查询同连接同事务」的连接上设 RLS 设置后执行任意 SQL（模拟直连绕过） */
  async function withRlsTx<T>(
    settings: IWalnutAdminDataScopeRlsSettings,
    fn: (qr: QueryRunner) => Promise<T>,
  ): Promise<T> {
    const qr = pgDataSource.createQueryRunner()
    await qr.connect()
    await qr.startTransaction()

    try {
      await applyWalnutDataScopeRlsSettings(qr.manager, settings)
      return await fn(qr)
    }
    finally {
      await qr.rollbackTransaction().catch(() => undefined)
      await qr.release()
    }
  }

  const scoped = (deptIds: string[], userId = userA): IWalnutAdminDataScopeRlsSettings => ({
    mode: WALNUT_DATA_SCOPE_RLS_MODE.SCOPED,
    userId,
    deptIds,
  })

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    adminPgDataSource = getWalnutPgAdminDataSource(app)

    const deptRows: Array<{ id: string }> = await adminPgDataSource.query(
      `INSERT INTO sys_dept (dept_code, dept_name) VALUES ($1, $2), ($3, $4) RETURNING id`,
      [`${prefix}-a`, `${prefix}-A`, `${prefix}-b`, `${prefix}-B`],
    )
    deptA = deptRows[0].id
    deptB = deptRows[1].id

    await insertDemo('dept-a', userB, deptA)
    await insertDemo('dept-b', userB, deptB)
    await insertDemo('own-null-dept', userA, null)
    await insertDemo('other-null-dept', userB, null)
  })

  afterAll(async () => {
    // 管理连接清理（运维通道）
    await adminPgDataSource.query('DELETE FROM app_demo WHERE demo_string LIKE $1', [`${prefix}%`])
    await adminPgDataSource.query('DELETE FROM sys_dept WHERE dept_code LIKE $1', [`${prefix}%`])
    await app.close()
  })

  it('运行时连接是受限角色 walnut_app（非 superuser / 非 bypassrls / 非表 owner）', async () => {
    const rows: Array<{ current_user: string, rolsuper: boolean, rolbypassrls: boolean }>
      = await pgDataSource.query(
        'SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      )

    expect(rows[0].current_user).toBe('walnut_app')
    expect(rows[0].rolsuper).toBe(false)
    expect(rows[0].rolbypassrls).toBe(false)

    const owners: Array<{ tableowner: string }> = await pgDataSource.query(
      `SELECT tableowner FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1::text[])`,
      [REGISTERED_TABLES],
    )
    expect(owners).toHaveLength(REGISTERED_TABLES.length)
    expect(owners.every(owner => owner.tableowner !== 'walnut_app')).toBe(true)
  })

  it('七张注册表都启用 ENABLE + FORCE RLS，且各有 PERMISSIVE 基线 + RESTRICTIVE 天花板', async () => {
    const tables: Array<{ relname: string, relrowsecurity: boolean, relforcerowsecurity: boolean }>
      = await pgDataSource.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
         FROM pg_class WHERE relname = ANY($1::text[]) AND relkind = 'r'`,
        [REGISTERED_TABLES],
      )

    expect(tables).toHaveLength(REGISTERED_TABLES.length)
    for (const table of tables) {
      expect(table.relrowsecurity, `${table.relname} relrowsecurity`).toBe(true)
      expect(table.relforcerowsecurity, `${table.relname} relforcerowsecurity`).toBe(true)
    }

    const policies: Array<{ tablename: string, policyname: string, permissive: string, roles: string[] }>
      = await pgDataSource.query(
        `SELECT tablename, policyname, permissive, roles
         FROM pg_policies WHERE tablename = ANY($1::text[])`,
        [REGISTERED_TABLES],
      )

    for (const tableName of REGISTERED_TABLES) {
      const own = policies.filter(policy => policy.tablename === tableName)

      expect(own.map(policy => policy.policyname).sort()).toEqual(['p_data_scope_access', 'p_data_scope_ceiling'])
      expect(own.find(policy => policy.policyname === 'p_data_scope_access')?.permissive).toBe('PERMISSIVE')
      expect(own.find(policy => policy.policyname === 'p_data_scope_ceiling')?.permissive).toBe('RESTRICTIVE')
      expect(own.every(policy => policy.roles.includes('walnut_app'))).toBe(true)
    }
  })

  it('scoped：绕过应用层直连 SELECT 只能看到 部门天花板 ∪ 本人 的行', async () => {
    const rows = await withRlsTx(scoped([deptA]), async qr =>
      qr.manager.query<Array<{ demo_string: string }>>(
        'SELECT demo_string FROM app_demo WHERE demo_string LIKE $1 ORDER BY demo_string',
        [`${prefix}%`],
      ))

    expect(rows.map(row => row.demo_string)).toEqual([
      `${prefix}-dept-a`,
      `${prefix}-own-null-dept`,
    ])
  })

  it('scoped：天花板外的 INSERT 撞 WITH CHECK（应用层漏过滤也写不进去）', async () => {
    await expect(withRlsTx(scoped([deptA]), async qr => qr.manager.query<unknown>(
      `INSERT INTO app_demo
        (demo_string, demo_string_array, demo_number_array, demo_boolean_array,
         demo_date_array, demo_enum_array, demo_uuid_array, created_by, dept_id)
       VALUES ($1, ARRAY['x'], ARRAY[1], ARRAY[true], ARRAY[now()], ARRAY[1], ARRAY[gen_random_uuid()], $2, $3)`,
      [`${prefix}-forbidden`, userB, deptB],
    ))).rejects.toThrow(/row-level security/i)
  })

  it('scoped：天花板外的 UPDATE 命中 0 行（USING 收窄）', async () => {
    // TypeORM 1.x 的 pg 驱动对 UPDATE 返回 [rows, affectedCount]
    const changed = await withRlsTx(scoped([deptA]), async qr => qr.manager.query<[Array<{ id: string }>, number]>(
      'UPDATE app_demo SET demo_number = 42 WHERE demo_string = $1 RETURNING id',
      [`${prefix}-dept-b`],
    ))

    expect(changed[0]).toHaveLength(0)
    expect(changed[1]).toBe(0)
  })

  it('anonymous：fail-closed（SELECT 0 行、INSERT 拒绝）', async () => {
    const settings: IWalnutAdminDataScopeRlsSettings = {
      mode: WALNUT_DATA_SCOPE_RLS_MODE.ANONYMOUS,
      userId: '',
      deptIds: [],
    }

    const rows = await withRlsTx(settings, async qr => qr.manager.query<Array<{ demo_string: string }>>(
      'SELECT demo_string FROM app_demo WHERE demo_string LIKE $1',
      [`${prefix}%`],
    ))
    expect(rows).toHaveLength(0)

    await expect(withRlsTx(settings, async qr => qr.manager.query<unknown>(
      `INSERT INTO app_demo
        (demo_string, demo_string_array, demo_number_array, demo_boolean_array,
         demo_date_array, demo_enum_array, demo_uuid_array)
       VALUES ($1, ARRAY['x'], ARRAY[1], ARRAY[true], ARRAY[now()], ARRAY[1], ARRAY[gen_random_uuid()])`,
      [`${prefix}-anonymous`],
    ))).rejects.toThrow(/row-level security/i)
  })

  it('all：root 档位看到全部行（含无主/NULL dept）', async () => {
    const rows: Array<{ demo_string: string }> = await withRlsTx(
      { mode: WALNUT_DATA_SCOPE_RLS_MODE.ALL, userId: userA, deptIds: [] },
      async qr => qr.manager.query<Array<{ demo_string: string }>>(
        'SELECT demo_string FROM app_demo WHERE demo_string LIKE $1',
        [`${prefix}%`],
      ),
    )

    expect(rows).toHaveLength(4)
  })

  it('sys_user / sys_employee WITH CHECK：本人行改 dept_id 到天花板外被拒，部门不变放行', async () => {
    const ownUserId = randomUUID()
    const employeeId = randomUUID()

    await adminPgDataSource.query(
      'INSERT INTO sys_user (id, user_name, dept_id) VALUES ($1, $2, $3)',
      [ownUserId, `${prefix}-self`, deptA],
    )
    await adminPgDataSource.query(
      `INSERT INTO sys_employee (id, employee_no, employee_name, dept_id, user_id, entry_date)
       VALUES ($1, $2, $3, $4, $5, now())`,
      [employeeId, `${prefix}-e1`, 'RLS Self', deptA, ownUserId],
    )

    const settings: IWalnutAdminDataScopeRlsSettings = {
      ...scoped([deptA], ownUserId),
      userDeptId: deptA,
    }

    try {
      // 把自家账号 dept 改到天花板外（deptB 不在 deptIds、也不等于账号当前部门）→ 拒绝
      await expect(withRlsTx(settings, async qr => qr.manager.query<unknown>(
        'UPDATE sys_user SET dept_id = $1 WHERE id = $2',
        [deptB, ownUserId],
      ))).rejects.toThrow(/row-level security/i)

      // 部门不变的自助更新 → 放行
      const changedUser = await withRlsTx(settings, async qr => qr.manager.query<[Array<{ id: string }>, number]>(
        'UPDATE sys_user SET nick_name = $1 WHERE id = $2 RETURNING id',
        ['self-nick', ownUserId],
      ))
      expect(changedUser[1]).toBe(1)

      // 职工行同样：改 dept 到天花板外 → 拒绝；部门不变 → 放行
      await expect(withRlsTx(settings, async qr => qr.manager.query<unknown>(
        'UPDATE sys_employee SET dept_id = $1 WHERE id = $2',
        [deptB, employeeId],
      ))).rejects.toThrow(/row-level security/i)

      const changedEmployee = await withRlsTx(settings, async qr => qr.manager.query<[Array<{ id: string }>, number]>(
        'UPDATE sys_employee SET employee_name = $1 WHERE id = $2 RETURNING id',
        ['RLS Self Renamed', employeeId],
      ))
      expect(changedEmployee[1]).toBe(1)
    }
    finally {
      await adminPgDataSource.query('DELETE FROM sys_employee WHERE id = $1', [employeeId])
      await adminPgDataSource.query('DELETE FROM sys_user WHERE id = $1', [ownUserId])
    }
  })

  it('未设置（应用连接池级 manager）：缺省 anonymous，fail-closed 0 行；管理连接完整', async () => {
    // P1-1：运行时角色的池级直连不再有任何“忘设置也放行”的兜底
    const appRows: Array<{ count: number }> = await pgDataSource.query(
      'SELECT count(*)::int AS count FROM app_demo WHERE demo_string LIKE $1',
      [`${prefix}%`],
    )
    expect(appRows[0].count).toBe(0)

    // 运维/迁移/导出通道走管理角色（DATABASE_PG_USER），天然绕 RLS
    const adminRows: Array<{ count: number }> = await adminPgDataSource.query(
      'SELECT count(*)::int AS count FROM app_demo WHERE demo_string LIKE $1',
      [`${prefix}%`],
    )
    expect(adminRows[0].count).toBe(4)
  })
})
