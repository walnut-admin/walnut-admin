import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppKeyEntity } from '@/modules/app/key/entity/key.entity'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * B 段：`app/key` 三端点（current/init/rotate）—— service 层已有 int-spec 覆盖
 * （app.key.int-spec.ts），这里补 API 级 HTTP 全链（JWT 守卫 + HasRole(root) + 路由
 * 参数枚举 pipe + rotate 的 @WalnutTx 事务拦截器）。
 *
 * 数据自洽口径（与 int-spec 双向隔离）：文件执行顺序不保证，因此 ——
 * - rotate 目标不赌现网行：beforeAll 自插一行高 version 的 ACTIVE RSA_PAIR（getCurrentActiveKey
 *   取 version 最大者，rotate 必命中它），afterAll 删掉本轮两行（种子行 + rotate 新行），
 *   既有行（int-spec 留下的 v1/v2）不动；
 * - init 选 AES_KEY_URL 走「清空该类型 → init 落首条 → 二钻 40001」闭环，afterAll 清空
 *   AES 行（int-spec 的 initFirst(AES) 同样要求空表，两个方向都安全）。
 * - init 不选 JWT_AT：generateNewKeyByType 无该分支 → 恒 20000 且不落行，二钻不可达。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface KeyMeta {
  publicKeyPem?: string
  privateKeyPem?: string
  keyB64?: string
}

interface KeyRow {
  id: string
  key?: string
  type?: string
  version?: number
  status?: string
  meta?: KeyMeta
}

describe('B 段：app/key current/init/rotate（真实 HTTP 全链 + rotate 事务）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null

  /** beforeAll 自插的 rotate 目标行（高 version ACTIVE RSA_PAIR） */
  let seededRsa: AppKeyEntity | null = null
  let seededRsaVersion = 0
  let seededPublicKeyPem = ''
  /** 本轮 HTTP 调用新产生的行 id（rotate 新行 / init 首条），afterAll 一并清 */
  const createdIds: string[] = []

  async function deleteRows(ids: string[]) {
    if (ids.length > 0) {
      await api.pgDataSource.getRepository(AppKeyEntity).delete(ids)
    }
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `key-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 自插 rotate 目标行：version 取现网最大 + 1000，保证 getCurrentActiveKey/rotate 命中它
    const repo = api.pgDataSource.getRepository(AppKeyEntity)
    // 同 key.service 的生成形态（encoding options 直接给 PEM 字符串）
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    seededPublicKeyPem = pair.publicKey
    const maxVersionRows: Array<{ max_version: string }> = await api.pgDataSource.query(
      `SELECT COALESCE(MAX(version), 0) AS max_version FROM app_key WHERE type = 'RSA_PAIR'`,
    )
    seededRsaVersion = Number(maxVersionRows[0].max_version) + 1000
    seededRsa = await repo.save({
      key: `rsa-apispec-${seed8}`,
      type: 'RSA_PAIR',
      version: seededRsaVersion,
      status: 'ACTIVE',
      validStart: new Date(),
      validEnd: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      meta: { publicKeyPem: pair.publicKey, privateKeyPem: pair.privateKey, bits: 2048, cipher: 'AES-256-GCM' },
    })
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      if (seededRsa !== null) {
        await deleteRows([seededRsa.id])
      }
      await deleteRows(createdIds)
      // init 用例的自洽基线：AES_KEY_URL 清空（int-spec initFirst(AES) 同样要求空表）
      await api.pgDataSource.getRepository(AppKeyEntity).delete({ type: 'AES_KEY_URL' })

      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('current/RSA_PAIR → 20000，返回当前 ACTIVE（version 最大）行的 PEM 对', async () => {
    const res = await api.root('GET', api.apiPath('/app/key/current/RSA_PAIR'))
    expectOk(res, 'key current rsa')

    const data = bodyOf<KeyMeta>(res).data
    expect(data.publicKeyPem).toBe(seededPublicKeyPem)
    expect(data.privateKeyPem).toContain('BEGIN PRIVATE KEY')
  })

  it('current/AES_KEY_URL → 20000（keyB64 形状；空表时 data 为空对象）', async () => {
    // afterAll 前该类型可能带 int-spec 残留行 —— 只断言形状，不断言内容
    const res = await api.root('GET', api.apiPath('/app/key/current/AES_KEY_URL'))
    expectOk(res, 'key current aes')
    expect(bodyOf(res).data).toBeTypeOf('object')
  })

  it('rotate/RSA_PAIR → 20000：旧行 DEPRECATED + 新行 version+1 ACTIVE（事务两腿齐落）', async () => {
    const res = await api.root('POST', api.apiPath('/app/key/rotate/RSA_PAIR'))
    expectOk(res, 'key rotate')

    const created = bodyOf<KeyRow>(res).data
    expect(created.id).toMatch(UUID_RE)
    expect(created.version).toBe(seededRsaVersion + 1)
    expect(created.status).toBe('ACTIVE')
    expect(created.meta?.publicKeyPem).toBeTruthy()
    expect(created.meta?.publicKeyPem).not.toBe(seededPublicKeyPem)
    createdIds.push(created.id)

    const repo = api.pgDataSource.getRepository(AppKeyEntity)
    const oldRow = await repo.findOne({ where: { id: seededRsa!.id } })
    expect(oldRow?.status).toBe('DEPRECATED')
    const newRow = await repo.findOne({ where: { id: created.id } })
    expect(newRow?.status).toBe('ACTIVE')
    expect(newRow?.meta?.privateKeyPem).toContain('BEGIN PRIVATE KEY')

    // current 随轮转换人
    const currentRes = await api.root('GET', api.apiPath('/app/key/current/RSA_PAIR'))
    expect(bodyOf<KeyMeta>(currentRes).data.publicKeyPem).toBe(created.meta?.publicKeyPem)
  })

  it('init（AES_KEY_URL）：空表落首条 v1 ACTIVE；二钻 → 40001', async () => {
    // 自洽基线：清空该类型（可能带 int-spec 残留），init 的「首条」语义才成立
    await api.pgDataSource.getRepository(AppKeyEntity).delete({ type: 'AES_KEY_URL' })

    const initRes = await api.root('POST', api.apiPath('/app/key/init'), { type: 'AES_KEY_URL' })
    expectOk(initRes, 'key init first')
    const created = bodyOf<KeyRow>(initRes).data
    expect(created.id).toMatch(UUID_RE)
    expect(created.version).toBe(1)
    expect(created.status).toBe('ACTIVE')
    expect(created.meta?.keyB64).toBeTruthy()
    createdIds.push(created.id)

    const secondRes = await api.root('POST', api.apiPath('/app/key/init'), { type: 'AES_KEY_URL' })
    expect(bodyOf(secondRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)
  })

  it('current/:type 枚举外 type → 40099；未登录 current → 40101', async () => {
    const badType = await api.root('GET', api.apiPath('/app/key/current/NOT_A_TYPE'))
    expect(bodyOf(badType).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const anonRes = await api.anon('GET', api.apiPath('/app/key/current/RSA_PAIR'))
    expect(bodyOf(anonRes).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})
