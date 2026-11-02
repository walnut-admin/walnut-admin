import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { AppKeyEntity } from '@walnut-server/app-domain'
import { AuthOpaqueCoreService } from '@walnut-server/auth'
import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { SysUserSharedService } from '@walnut-server/identity'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import supertest from 'supertest'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture, WALNUT_DEFAULT_VISITOR_ROLE_UUID } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { WALNUT_TEST_USER_AGENT } from './helpers/sign-handshake'

/**
 * G 段：真实并发/锁专项（此前 434 用例全部串行请求 —— 悲观锁、ON CONFLICT upsert、
 * 唯一约束竞态只有代码没有并行验证）。
 *
 * 并行口径：单测试内 `Promise.all` 多请求（vitest 未开并发 worker、集成库文件级串行，
 * 独占安全）；请求经真实 HTTP 栈入站，事务由 `WalnutTxInterceptor` 逐请求开提。
 *
 * 实测结论先记（各用例内有详细注释，条目收编于 DESIGN-ISSUES.md）：
 * - G1 RT 重放：悲观锁挡不住并发重放（P0-1：轮换是同 jti 原地换锁，等锁事务读到的
 *   永远是「新的一轮未撤销行」）—— **2026-10-27 二次重构为 revoke-and-insert**：轮换 =
 *   旧行置撤销（reason=rotate）+ INSERT 新行，旧行 jti 行级作废，恰 1 路 20000 由
 *   「入口快照比对」（2026-10-26 首修，只挡真正同时到达的请求、错峰实测出过 2×20000）
 *   升级为**确定性成立**（败者要么 guard 层读到撤销行、要么锁内读到撤销行）；
 * - G6 key rotate：P1-1 已修（2026-10-28）—— 读腿在事务内 FOR UPDATE，两路并发 rotate
 *   由行锁串行化，恰一条 ACTIVE、败者受控 40401（修复前读腿无锁产生两条同 version ACTIVE）。
 *
 * Throttle 预算：device/initial 是 4 次/60s（tracker=realIp，存储按 app 实例隔离）——
 * 本文件 bootstrap 1 次 + G3 竞态 3 次 = 恰好 4 次，压线不超。
 */

interface DemoRow {
  id: string
  demoString?: string
}

describe('G 段：并发/锁专项（真实 HTTP 并行 + service 级注册竞态）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  /** G3 竞态设备的业务键（deviceId 由指纹派生，成功响应里取） */
  let raceDeviceId = ''
  /** G5 回收站竞态涉及的主行/快照行 id（清场兜底） */
  const demoIds: string[] = []
  const deletedDemoIds: string[] = []
  /** G6 key rotate 竞态新产生的行 id */
  const createdKeyIds: string[] = []
  let seededKeyVersion = 0
  /** G2 注册竞态落库的 user id（恰一行胜出者） */
  let raceUserId = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `conc-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (raceUserId !== '') {
        await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [raceUserId])
      }
      if (demoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM app_demo WHERE id = ANY($1::uuid[])', [demoIds])
      }
      if (deletedDemoIds.length > 0) {
        await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [deletedDemoIds])
      }
      if (createdKeyIds.length > 0) {
        await api.pgDataSource.getRepository(AppKeyEntity).delete(createdKeyIds)
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      // 设备行（bootstrap + G3 竞态设备）与设备缓存键
      const deviceIds = [api.deviceId, ...(raceDeviceId !== '' ? [raceDeviceId] : [])]
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [deviceIds])
      const deviceCache = app.get(AppTechCacheDeviceService)
      for (const deviceId of deviceIds) {
        await deviceCache.delSysDeviceCache(deviceId)
      }
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, raceDeviceId, fixture.userId, raceUserId)
    }
    await app.close()
  })

  function demoPayload(tag: string) {
    return {
      demoString: `CONC-${seed8.toUpperCase()}-${tag}`,
      demoPhoneNumber: `139${randomUUID().replaceAll('-', '').slice(0, 8)}`,
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

  async function createDemo(tag: string): Promise<DemoRow> {
    const res = await api.root('POST', api.apiPath('/app/demo'), demoPayload(tag))
    expectOk(res, `demo create ${tag}`)
    const row = bodyOf<DemoRow>(res).data
    demoIds.push(row.id)
    return row
  }

  it('G1 同一 RT_JTI 五路并发 refresh —— 恰 1 路成功、其余 40102（revoke-and-insert，确定性）', async () => {
    // 前置：登录链已落恰好一行 RT（行 jti 是明文 nanoid；cookie 值带签名前缀不宜反解，
    // 按 user+device 定位行 —— auth-session spec 同口径）
    expect(api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)).toBeTruthy()

    const before: Array<{ jti: string, encrypted_token: string, expired_at: Date, revoked: boolean }>
      = await api.pgDataSource.query(
        'SELECT jti, encrypted_token, expired_at, revoked FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
        [fixture!.userId, api.deviceId],
      )
    expect(before).toHaveLength(1)
    expect(before[0].revoked).toBe(false)
    const jti = before[0].jti

    // 五路并发重放同一 RT cookie（refresh 全 Free + JwtRefreshGuard，unsigned 直发即可；
    // 共用同一客户端的 cookie jar 无碍 —— 只有胜者回种新 jti，败者 40102 不带 Set-Cookie）。
    // 胜者把旧行置撤销后，败者无论走到哪道闸都被拦：guard 入口 getTokenByJti 读到撤销行，
    // 或轮换事务锁内 findByJti 读到撤销行（锁只串行化「读校验+撤销+插入」）。
    const N = 5
    const responses = await Promise.all(
      Array.from({ length: N }, async () => api.unsigned('POST', api.apiPath('/auth/refresh'))),
    )
    const codes = responses.map(res => bodyOf(res).code)

    // 底线：无未受控错误（全 2xxxx/4xxxx）
    expect(codes.filter(code => code >= 50000)).toEqual([])

    // 【revoke-and-insert（2026-10-27）】恰 1 路胜出、其余受控 40102 —— 行级撤销后
    // 确定性成立（对照历史：原地换锁时代五路全 20000；快照比对时代 1×20000 但依赖
    // 「五路在胜者提交前读到同一密文」的时序假设，错峰到达实测出过 2×20000）。
    expect(codes.filter(code => code === WalnutAdminConstAppResponseCode.SUCCESS)).toHaveLength(1)
    expect(codes.filter(code => code !== WalnutAdminConstAppResponseCode.SUCCESS))
      .toEqual(Array.from({ length: N - 1 }).fill(WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED))

    // 行形态自洽：该会话恰两行 —— 旧行 revoked（reason=rotate）+ 新行未撤销（密文换新）
    const after: Array<{ jti: string, encrypted_token: string, revoked: boolean, revoke_reason: string | null }>
      = await api.pgDataSource.query(
        'SELECT jti, encrypted_token, revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2 ORDER BY created_at ASC',
        [fixture!.userId, api.deviceId],
      )
    expect(after).toHaveLength(2)
    expect(after[0].jti).toBe(jti)
    expect(after[0].revoked).toBe(true)
    expect(after[0].revoke_reason).toBe('rotate')
    expect(after[0].encrypted_token).toBe(before[0].encrypted_token)
    expect(after[1].jti).not.toBe(jti)
    expect(after[1].revoked).toBe(false)
    expect(after[1].encrypted_token).not.toBe(before[0].encrypted_token)

    // 胜者回种 cookie 的新 jti == 新行 jti（jar 被唯一一个成功响应的 Set-Cookie 更新；
    // signed cookie 值经 encodeURIComponent（`s:` → `s%3A`）且形如 s:<jti>.<sig>，
    // jti 为 nanoid 不含 `.`，解码后剥前缀/签名比对）
    const cookieJti = decodeURIComponent(api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!)
      .replace(/^s:/, '')
      .replace(/\.[^.]+$/, '')
    expect(cookieJti).toBe(after[1].jti)
  })

  it('G2 同一用户两路并发补挂口令（service 级 finishRegister upsert）—— 两路皆成功、identity 恰一行', async () => {
    // P1-14（2026-10-28）：register 语义定为「已登录用户补挂口令」—— 服务层按 userId
    // upsert password identity（不再按 userName 查重、不建用户）。新用户注册走 OTP 链，
    // 本端点没有注册面。并发写腿由 uq_identity(user_id,type,purpose) + ON CONFLICT
    // 原子收敛：两路都成功，库中恰一行（旧 UQ 竞态用例随语义变更退役）。
    const configService = app.get(ConfigService)
    const opaqueCore = app.get(AuthOpaqueCoreService)
    const userShared = app.get(SysUserSharedService)
    const appName = configService.get<string>('app.name')!
    const userName = `conc-reg-${seed8}`

    // createForAuthUser 的 junction FK 依赖 functionalRole 缺省 uuid（auth-login 助手同款前置）
    await api.pgDataSource.query(
      'INSERT INTO sys_role (id, role_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
      [WALNUT_DEFAULT_VISITOR_ROLE_UUID, `conc-reg-visitor-${seed8}`],
    )

    // 目标用户（真实 createForAuthUser 写腿；随后两路并发补挂同一 password identity）
    const targetUser = await userShared.createForAuthUser({ userName }, api.pgDataSource.manager)
    raceUserId = targetUser.id

    // 两份真实 opaque registration record（串行备料，竞态只在写腿）
    async function makeRecord(): Promise<string> {
      const password = `Pwd-${randomUUID().slice(0, 12)}#42`
      const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
      const registrationResponse = await opaqueCore.startRegister(userName, registrationRequest)
      const { registrationRecord } = opaque.client.finishRegistration({
        clientRegistrationState,
        registrationResponse,
        password,
        identifiers: { client: userName, server: appName },
      })
      return registrationRecord
    }
    const [recordA, recordB] = [await makeRecord(), await makeRecord()]

    // 两路并发：各自独立 PG 事务（与拦截器 @WalnutTx 的 queryRunner 事务同构）
    const results = await Promise.all([
      api.pgDataSource.transaction(async em => opaqueCore.finishRegister(raceUserId, recordA, em)),
      api.pgDataSource.transaction(async em => opaqueCore.finishRegister(raceUserId, recordB, em)),
    ])
    expect(results).toEqual([true, true])

    // 库里恰一行 user + 恰一条 password identity（value_hash 是其中一份 record，逐字节）
    const users: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_user WHERE user_name = $1',
      [userName],
    )
    expect(users).toHaveLength(1)
    expect(users[0].id).toBe(raceUserId)

    const identities: Array<{ c: number, value_hash: string }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c, min(value_hash) AS value_hash FROM sys_user_identity WHERE user_id = $1 AND type = $2 AND purpose = $3',
      [raceUserId, 'password', 'login'],
    )
    expect(identities[0].c).toBe(1)
    expect([recordA, recordB]).toContain(identities[0].value_hash)
  })

  it('G3 同一指纹三路并发 device/initial —— 恰一行落库，冲突侧受控 40000（P3-2：23505 单列映射，无 50000）', async () => {
    const fingerprint = `conc-dev-${seed8}`
    const deviceName = `conc-dev-${seed8}`
    const payload = {
      deviceName,
      deviceInfo: {},
      hardwareInfo: {},
      sr: { height: 1080, width: 1920 },
      vp: { height: 900, width: 1600 },
      private: false,
    }

    // 裸 supertest 三路并发（同指纹 ⇒ 同 deviceId，initial 走「查到即覆盖/否则插入」——
    // 并发首插在 uq_device_id 上决出唯一胜者，败者 23505 进 catch-all → 受控 40605）
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        supertest(app.getHttpServer())
          .post(api.apiPath('/system/device/initial'))
          .set('user-agent', WALNUT_TEST_USER_AGENT)
          .set('X-Fingerprint', fingerprint)
          .send(payload)),
    )
    const codes = responses.map(res => (res.body as { code: number }).code)

    // 底线：无未受控错误；且至少一路成功
    expect(codes.filter(code => code >= 50000)).toEqual([])
    expect(codes).toContain(WalnutAdminConstAppResponseCode.SUCCESS)
    // 失败侧全部是 23505 单列映射的 40000（P3-2 修复前是 catch-all 的 40605）
    expect(codes.every(code => code === WalnutAdminConstAppResponseCode.SUCCESS
      || code === WalnutAdminConstAppResponseCode.BAD_REQUEST)).toBe(true)

    // 成功侧回同一 deviceId；库恰一行
    const deviceIds = responses
      .filter(res => (res.body as { code: number }).code === WalnutAdminConstAppResponseCode.SUCCESS)
      .map(res => (res.body as { data: { deviceId: string } }).data.deviceId)
    expect(new Set(deviceIds).size).toBe(1)
    raceDeviceId = deviceIds[0]

    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_device WHERE device_name = $1',
      [deviceName],
    )
    expect(rows[0].c).toBe(1)
  })

  it('G4 同一 user 四段并发 PATCH preference —— ON CONFLICT DO UPDATE 按列回写，四段齐落无死锁', async () => {
    // 起点干净（无偏好行）：四路并发首插在 uq_user_preference_user 上决出插入者，
    // 其余走 ON CONFLICT (user_id) DO UPDATE 只回写各自携带列
    await api.pgDataSource.query('DELETE FROM sys_user_preference WHERE user_id = $1', [fixture!.userId])

    const responses = await Promise.all([
      api.root('PATCH', api.apiPath('/system/user/preference/basic'), { locale: 'en_US' }),
      api.root('PATCH', api.apiPath('/system/user/preference/accessibility'), {
        fontSize: 16,
        reducedMotion: true,
        colorMode: 'grayscale',
        CVD: 'protanopia',
      }),
      api.root('PATCH', api.apiPath('/system/user/preference/theme'), { dark: true }),
      api.root('PATCH', api.apiPath('/system/user/preference/layout'), {
        layoutMode: 'top-menu',
        layout: { header: { inverted: false } },
      }),
    ])
    // 全部 20000：单语句 upsert 在行锁上自然串行，无死锁/超时
    for (const res of responses) {
      expectOk(res, 'preference concurrent patch')
    }

    // 最终行 = 各段字段都落了（ON CONFLICT 按列回写语义：四个并发请求更新互不相交的列组，
    // 串行化后全部生效 —— 不存在整行 last-write-wins 丢段）
    const readRes = await api.root('GET', api.apiPath('/system/user/preference/read'))
    expectOk(readRes, 'preference read after race')
    const data = bodyOf<{
      basic: { locale: string }
      accessibility: { fontSize: number, reducedMotion: boolean, colorMode: string, CVD: string | null }
      theme: { dark: boolean }
      layout: { layoutMode: string }
    }>(readRes).data
    expect(data.basic.locale).toBe('en_US')
    expect(data.accessibility).toEqual({ fontSize: 16, reducedMotion: true, colorMode: 'grayscale', CVD: 'protanopia' })
    expect(data.theme.dark).toBe(true)
    expect(data.layout.layoutMode).toBe('top-menu')
  })

  it('G5 同一 sys_deleted 行两路并发 recover —— 恰一成功一受控失败，原集合恰一行', async () => {
    const demo = await createDemo('REC')
    const delRes = await api.root('DELETE', api.apiPath(`/app/demo/${demo.id}`))
    expectOk(delRes, 'demo soft delete')
    deletedDemoIds.push(demo.id)

    const snapshots: Array<{ id: string }> = await api.pgDataSource.query(
      'SELECT id FROM sys_deleted WHERE deleted_id = $1',
      [demo.id],
    )
    expect(snapshots).toHaveLength(1)
    const snapshotId = snapshots[0].id

    // 两路并发管理端恢复（root 短路 @HasRole；两条恢复腿「原表 insert + 快照行 delete」
    // 各自同事务）：败者要么读腿 NotFound（40401），要么原表 insert 撞 PK（40000 recoverFail）
    const [r1, r2] = await Promise.all([
      api.root('POST', api.apiPath('/system/deleted/recover'), { id: snapshotId, deletedId: demo.id }),
      api.root('POST', api.apiPath('/system/deleted/recover'), { id: snapshotId, deletedId: demo.id }),
    ])
    const codes = [bodyOf(r1).code, bodyOf(r2).code].sort((a, b) => a - b)
    expect(codes[0]).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    expect([WalnutAdminConstAppResponseCode.BAD_REQUEST, WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND])
      .toContain(codes[1])

    // 原集合恰恢复一行；快照行被胜者事务删掉且败者回滚没有把它带回来
    const demoRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM app_demo WHERE id = $1',
      [demo.id],
    )
    expect(demoRows[0].c).toBe(1)
    const snapRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE id = $1',
      [snapshotId],
    )
    expect(snapRows[0].c).toBe(0)
    deletedDemoIds.pop()
  })

  it('G6 同 type 两路并发 rotate —— 恰一条 ACTIVE、败者受控 40401（P1-1：读腿事务内 FOR UPDATE）', async () => {
    // 自插高 version 目标行（key.api-spec 同款自洽法）：rotate 命中 version 最大 ACTIVE 行。
    // app_key 是 RLS 豁免表 → 用应用连接造种子（与应用事务同一角色/可见性；管理连接是
    // 独立池，并发轮换用例里曾观察到种子行来不及被事务看到）
    const repo = api.appDataSource.getRepository(AppKeyEntity)
    const maxRows: Array<{ max_version: string }> = await api.appDataSource.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM app_key WHERE type = 'RSA_PAIR'`,
    )
    seededKeyVersion = Number(maxRows[0].max_version) + 1000
    const seeded = await repo.save({
      key: `rsa-conc-${seed8}`,
      type: 'RSA_PAIR',
      version: seededKeyVersion,
      status: 'ACTIVE',
      validStart: new Date(),
      validEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      meta: { bits: 2048, cipher: 'AES-256-GCM' },
    })
    // 种子行一并进清场名单 —— initFirst 的 existsByType 不筛 status，残留行（哪怕已
    // DEPRECATED）会让后续 app.key.int-spec 的 initFirst 撞 DataExists（跨文件实测抓过）
    createdKeyIds.push(seeded.id)

    // 两路并发 rotate（@WalnutTx 各自事务）：P1-1 修复后 getCurrentActiveKey 在事务内
    // FOR UPDATE。两种合法时序：
    // ① 真正重叠 —— 胜者锁行、置种子行 DEPRECATED、插 version+1 后提交；败者等锁恢复后
    //    在 READ COMMITTED 下重判 WHERE（status 已非 ACTIVE）→ 40400（NotFound）；
    // ② 事件循环把两路串行化 —— 第二路看到的是新 ACTIVE 行，会合法地再轮换一次（version+2）。
    // 两者都不允许出现「同 version 双 ACTIVE」—— 这才是 P1-1 的回归判据（修复前两路
    // 各插一条 version+1 ACTIVE）。
    const [r1, r2] = await Promise.all([
      api.root('POST', api.apiPath('/app/key/rotate/RSA_PAIR')),
      api.root('POST', api.apiPath('/app/key/rotate/RSA_PAIR')),
    ])
    const codes = [bodyOf(r1).code, bodyOf(r2).code].sort((a, b) => a - b)
    expect(codes[0]).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    expect([WalnutAdminConstAppResponseCode.SUCCESS, WalnutAdminConstAppResponseCode.NOT_FOUND]).toContain(codes[1])

    const successResults = [r1, r2]
      .filter(res => bodyOf(res).code === WalnutAdminConstAppResponseCode.SUCCESS)
      .map(res => bodyOf<{ id: string, version: number }>(res).data)
      .sort((a, b) => a.version - b.version)
    expect(successResults[0].version).toBe(seededKeyVersion + 1)
    if (successResults.length === 2) {
      expect(successResults[1].version).toBe(seededKeyVersion + 2)
    }
    for (const row of successResults) {
      createdKeyIds.push(row.id)
    }

    // 竞态轮次按成功的 version 圈定 ACTIVE 行（集成库可能残留其他历史 ACTIVE 行，
    // 不影响「同轮不得双插」的判据）：每个 version 恰一条 ACTIVE，条数 = 成功路数，
    // 且 set(version) 无重复 —— 修复前此处会是同 version 两条。
    const successVersions = successResults.map(row => row.version)
    const actives: Array<{ id: string, version: number, status: string }> = await api.pgDataSource.query(
      `SELECT id, version, status FROM app_key WHERE type = 'RSA_PAIR' AND status = 'ACTIVE' AND version = ANY($1::int[])`,
      [successVersions],
    )
    expect(actives).toHaveLength(successResults.length)
    expect(actives.map(row => row.id).sort()).toEqual(successResults.map(row => row.id).sort())
    expect(new Set(actives.map(row => row.version)).size).toBe(actives.length)

    const seededRow = await repo.findOne({ where: { id: seeded.id } })
    expect(seededRow?.status).toBe('DEPRECATED')
  })
})
