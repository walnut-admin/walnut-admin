import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { WALNUT_TEST_USER_AGENT } from './helpers/sign-handshake'

/**
 * H1：API 级事务回滚直测 —— 找真实可从 HTTP 触发中途失败的事务端点，断言
 * 「响应错误 + 库零残留」。每条用例验证的都是**拦截器（WalnutTxInterceptor）对真实
 * HTTP 请求的回滚传播**：handler 抛错 → catchError → rollbackTransaction → 原始错误
 * 透传给全局异常过滤器 → 统一 200 壳错误码。
 *
 * - role create（@WalnutTx，主行 + junction 两腿）：menus 给不存在 menuId →
 *   FK 23503 在第二腿拒绝 → 主行 + junction 全无残留；
 * - recover（@WalnutTx，原表 insert + 快照行 delete 两腿）：快照与现网行撞
 *   唯一键 → 40000 recoverFail → 快照行仍在、原集合零新增（B9 int-spec 的 service 级
 *   force-rollback 在 HTTP 层的同构验证）；
 * - after-commit 钩子的 API 级验证：device initial 的 SYS_DEVICE 缓存写入挂在
 *   registerAfterCommitHook —— 拦截器在 commit 后、响应 flush 前同步跑钩子，因此
 *   「响应返回的那一刻缓存必须已落」是钩子时序的端到端证明（零轮询）；
 * - demo create 同 payload 重复（23505）**不作回滚面**：create 无 @WalnutTx、
 *   单语句插入无第二腿可回滚（撞 uq_demo_phone_number → P1-7 后同样收敛为 40000，
 *   与 system/user create 同款，不重复布防）。
 *
 * Throttle 预算：device/initial 4 次/60s —— 本文件 bootstrap 1 次 + after-commit 用例
 * 1 次 = 2 次，安全。
 */

interface DemoRow {
  id: string
  demoString?: string
  demoPhoneNumber?: string
}

describe('H1：API 级事务回滚直测（真实 HTTP 触发中途失败 → 响应错误 + 库零残留）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  const demoIds: string[] = []
  const deletedDemoIds: string[] = []
  /** after-commit 用例产生的竞态外设备 */
  let hookDeviceId = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `rb-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (demoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [demoIds])
      }
      if (deletedDemoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [deletedDemoIds])
      }
      const deviceIds = [api.deviceId, ...(hookDeviceId !== '' ? [hookDeviceId] : [])]
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [deviceIds])
      // fixture 清场（其余 spec 同款两行，此前缺漏）：fixture 的 'root' 角色行若泄漏，
      // 且本文件恰是 menu.role.pg.int-spec（对 roleName='root' 裸插）前最后一个用
      // registerRootUserFixture 的 spec，全量跑 menu.role 必撞 uq_role_name（实测复现）
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, hookDeviceId, fixture.userId)
    }
    await app.close()
  })

  function demoPayload(tag: string) {
    return {
      demoString: `RB-${seed8.toUpperCase()}-${tag}`,
      demoPhoneNumber: `137${randomUUID().replaceAll('-', '').slice(0, 8)}`,
      demoNumber: 1,
      demoBoolean: true,
      demoDate: '2026-01-01T00:00:00.000Z',
      demoEnum: 1,
      demoMongoId: randomUUID(),
      demoObject: { o1: 'OBJ', o2: 2, o3: false },
      demoStringArray: ['1', 'a'],
      demoNumberArray: [-1, 2],
      demoBooleanArray: [true],
      demoDateArray: ['2026-01-01T00:00:00.000Z'],
      demoEnumArray: [1, 2],
      demoMongoIdArray: [randomUUID()],
    }
  }

  it('role create 带不存在的 menuId：FK 在 junction 腿拒绝 → 主行 + junction 全无残留', async () => {
    const roleName = `rb-role-${seed8}`
    const ghostMenuId = randomUUID()

    // @WalnutTx：第一腿 sys_role insert 成功 → 第二腿 sys_role_menu insert
    // 撞 fk_role_menu_menu（23503）→ 整体回滚。P1-7 修复后 23503 映射为受控 40000
    const res = await api.root('POST', api.apiPath('/system/role'), {
      roleName,
      description: `rollback probe ${seed8}`,
      order: 1,
      status: true,
      menus: [ghostMenuId],
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 库零残留：主行不在（junction 随 CASCADE 更不可能有）
    const roleRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_role WHERE role_name = $1',
      [roleName],
    )
    expect(roleRows[0].c).toBe(0)
    const junctionRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_role_menu rm JOIN sys_role r ON r.id = rm.role_id WHERE r.role_name = $1',
      [roleName],
    )
    expect(junctionRows[0].c).toBe(0)
  })

  it('recover 撞唯一键：原表 insert 腿失败 → 40000 recoverFail，快照行仍在、原集合零新增', async () => {
    // 造快照：demo A create → HTTP delete（软删 = 快照 + 原行硬删）
    const payloadA = demoPayload('SNAP')
    const createRes = await api.root('POST', api.apiPath('/app/demo'), payloadA)
    expectOk(createRes, 'demo create for snapshot')
    const demoA = bodyOf<DemoRow>(createRes).data
    demoIds.push(demoA.id)

    const delRes = await api.root('DELETE', api.apiPath(`/app/demo/${demoA.id}`))
    expectOk(delRes, 'demo soft delete')
    deletedDemoIds.push(demoA.id)

    const snapshots: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_deleted WHERE deleted_id = $1',
      [demoA.id],
    )
    expect(snapshots).toHaveLength(1)
    const snapshotId = snapshots[0].id

    // 构造唯一冲突（纯 HTTP）：A 已硬删，同 demoPhoneNumber（uq_demo_phone_number）再造
    // B 合法通过；此后 recover A 的「原表 insert 快照行」腿必撞唯一键
    const payloadB = { ...payloadA, demoString: `${payloadA.demoString}-B` }
    const createBRes = await api.root('POST', api.apiPath('/app/demo'), payloadB)
    expectOk(createBRes, 'demo create conflict occupant')
    const demoB = bodyOf<DemoRow>(createBRes).data
    demoIds.push(demoB.id)
    expect(demoB.demoPhoneNumber).not.toBeNull() // 响应面是脱敏壳，唯一键在库层面同值

    const occupantRows: Array<{ demo_phone_number: string }> = await api.pgDataSource.query(
      'SELECT demo_phone_number FROM app_demo WHERE id = $1',
      [demoB.id],
    )
    expect(occupantRows[0].demo_phone_number).toBe(payloadA.demoPhoneNumber)

    // HTTP recover：原表 insert 抛 23505 → 包装受控 recoverFail（40000）→ 同事务的
    // 「快照行 delete」腿被拦截器整体回滚
    const res = await api.root('POST', api.apiPath('/system/deleted/recover'), {
      id: snapshotId,
      deletedId: demoA.id,
    })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 库零残留：快照行仍在（delete 腿被回滚）；原集合没有多出 id=A 的行
    const snapRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE id = $1',
      [snapshotId],
    )
    expect(snapRows[0].c).toBe(1)
    const recoveredRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM app_demo WHERE id = $1',
      [demoA.id],
    )
    expect(recoveredRows[0].c).toBe(0)
  })

  it('P1-19 user create：junction 腿 FK 失败（roles=[有效角色, 不存在角色]）→ 40000 且主行零残留', async () => {
    const userName = `rb-user-${seed8}-bad`
    // 首角色必须有效：create 的 currentRole 落 roles[0]（F1 后显式 [] 为 null）；
    // 若首角色就是 ghost，失败会发生在主行 current_role_id FK、而不是 junction 腿。
    const roleRows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_role (role_name) VALUES ($1) RETURNING id',
      [`rb-user-role-${seed8}`],
    )
    const validRoleId = roleRows[0].id

    try {
      // 修复前 create 无 @WalnutTx：主行 save 已自动提交、junction insert 才撞
      // fk_user_role_role（23503）→ 留下「有用户行、role 绑定半空」的脏用户。
      // 现在主行 + junction 同事务，junction 腿失败整体回滚。
      const res = await api.root('POST', api.apiPath('/system/user'), {
        userName,
        status: true,
        roles: [validRoleId, randomUUID()],
      })
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

      const userRows: Array<{ c: number }> = await api.pgDataSource.query(
        'SELECT count(*)::int AS c FROM sys_user WHERE user_name = $1',
        [userName],
      )
      expect(userRows[0].c).toBe(0)
      const snapshotRows: Array<{ c: number }> = await api.pgDataSource.query(
        'SELECT count(*)::int AS c FROM sys_deleted WHERE content ->> \'userName\' = $1',
        [userName],
      )
      expect(snapshotRows[0].c).toBe(0)
    }
    finally {
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [validRoleId])
    }
  })

  it('P1-19 user update：junction 腿失败 → 40000，主行字段（status）与既有 junction 均未被半提交', async () => {
    const userName = `rb-user-${seed8}-keep`
    const roleRows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_role (role_name) VALUES ($1) RETURNING id',
      [`rb-user-role-keep-${seed8}`],
    )
    const validRoleId = roleRows[0].id

    try {
      const createRes = await api.root('POST', api.apiPath('/system/user'), {
        userName,
        status: true,
        roles: [validRoleId],
      })
      expectOk(createRes, 'user create for update rollback')
      const created = bodyOf<{ id: string }>(createRes).data

      // status:false（主行腿）+ roles=[有效, 不存在]（junction 腿：先 delete 再 insert，
      // insert 的 ghost role_id 撞 fk_user_role_role）—— 修复前主行 update 会先自动提交，
      // status 被改掉且 junction 已被 delete 清空。现在同事务整体回滚。
      const res = await api.root('PUT', api.apiPath(`/system/user/${created.id}`), {
        userName,
        status: false,
        roles: [validRoleId, randomUUID()],
      })
      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

      const rows: Array<{ status: boolean, current_role_id: string | null }> = await api.pgDataSource.query(
        'SELECT status, current_role_id FROM sys_user WHERE id = $1',
        [created.id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe(true)
      expect(rows[0].current_role_id).toBe(validRoleId)

      // junction 仍是替换前的有效绑定（delete 腿也被回滚）
      const junctionRows: Array<{ role_id: string }> = await api.pgDataSource.query(
        'SELECT role_id FROM sys_user_role WHERE user_id = $1',
        [created.id],
      )
      expect(junctionRows.map(row => row.role_id)).toEqual([validRoleId])

      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [created.id])
    }
    finally {
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [validRoleId])
    }
  })

  it('after-commit 钩子的 API 级验证：device initial 响应返回时 SYS_DEVICE 缓存已刷新（零轮询）', async () => {
    // 钩子挂在 registerAfterCommitHook（device.service.initial）——拦截器顺序为
    // commit → release → 钩子 → 响应 emit，因此「响应在手」即「钩子已跑完」。
    // 断言不做任何轮询/重试：这正是钩子在 commit 后执行的端到端证明
    // （若钩子被挂到 commit 前跑，事务内写缓存会在回滚场景留下脏缓存，且本断言的
    // 时序前提不复存在）。
    const fingerprint = `rb-hook-${seed8}`
    const raw = await supertest(app.getHttpServer())
      .post(api.apiPath('/system/device/initial'))
      .set('user-agent', WALNUT_TEST_USER_AGENT)
      .set('X-Fingerprint', fingerprint)
      .send({
        // B5 / P4：deviceName 由服务端生成，请求面不再带（带上来即 40099）
        deviceInfo: {},
        hardwareInfo: {},
        sr: { height: 1080, width: 1920 },
        vp: { height: 900, width: 1600 },
        private: false,
      })
    expect((raw.body as { code: number }).code).toBe(WalnutAdminConstAppResponseCode.SUCCESS)

    hookDeviceId = (raw.body as { data: { deviceId: string } }).data.deviceId
    const cacheKey = `${WalnutAdminConstAppCacheKeys.SYS_DEVICE}:${hookDeviceId}`
    expect(await api.hasWalnutCacheKey(cacheKey)).toBe(true)
  })
})
