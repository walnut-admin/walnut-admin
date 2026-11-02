import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { decryptAesKeyEnvelope } from './helpers/sign-handshake'

/**
 * D 段：`GET /shared/ali/sts`（真实 HTTP 全链）。
 *
 * 实现读定（不硬造）：service 用 env 的 `vendor.ali.OSS` 凭证直连阿里云 STS
 * （`sts.cn-beijing.aliyuncs.com`）assumeRole —— **env 配了 vendor key 就会发真实外网请求**，
 * 该调用结果取决于外部服务（凭证有效性 / 网络可达性），不属迁移回归也不可脚本稳定。
 * 本文件钉的是两端受控形态：
 * - 调用成功 → 20000 + 三个敏感字段（accessKeyId/accessKeySecret/stsToken）被
 *   `EncryptResponse` 换成设备握手 RSA 信封（用客户端私钥可解密回非空明文），region/bucket
 *   明文回显且与 env 一致；
 * - 调用失败（凭证无效/网络不可达，SDK 异常未映射受控异常）→ 统一响应壳 50000 兜底。
 * 两种结局都断言 `body.code` 契约（20000 XOR 50000），env 无 key 的环境同样是 50000 受控兜底。
 */

interface StsData {
  accessKeyId?: string
  accessKeySecret?: string
  stsToken?: string
  region?: string
  bucket?: string
}

describe('D 段：shared/ali/sts 受控形态（真实 HTTP 全链，外部 STS 调用不进回归断言）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let aliConfig: { region?: string, bucket?: string } = {}

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `shared-ali-${seed8}`)
    aliConfig = app.get(ConfigService).get('vendor.ali.OSS') ?? {}

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('sts → 受控两态：20000（敏感字段为握手 RSA 信封，region/bucket 与 env 一致）或 50000（外部调用失败兜底）', async () => {
    const res = await api.root('GET', api.apiPath('/shared/ali/sts'))
    const code = bodyOf<StsData>(res).code

    if (code === WalnutAdminConstAppResponseCode.SUCCESS) {
      // 成功态：三敏感字段是 EncryptResponse 信封（可解回非空明文），其余字段明文
      const data = bodyOf<StsData>(res).data
      expect(data.region).toBe(aliConfig.region)
      expect(data.bucket).toBe(aliConfig.bucket)

      for (const field of ['accessKeyId', 'accessKeySecret', 'stsToken'] as const) {
        const envelope = data[field]
        expect(typeof envelope).toBe('string')
        const plaintext = decryptAesKeyEnvelope(api.clientRsaPrivateKeyPem, envelope!)
        expect(plaintext.length).toBeGreaterThan(0)
        // 原始 stsToken 明文不出现在响应里
        expect(plaintext).not.toBe(envelope)
      }
    }
    else {
      // 失败态：SDK 异常（凭证无效/网络不可达）未映射受控异常 → 统一壳 50000 兜底
      expect(code).toBe(WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR)
    }
  })

  it('sts 匿名 → 40101（JWT guard 拦在权限点之前）', async () => {
    const res = await api.anon('GET', api.apiPath('/shared/ali/sts'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})
