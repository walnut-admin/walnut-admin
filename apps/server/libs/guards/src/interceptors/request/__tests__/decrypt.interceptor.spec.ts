import type { AppTechCacheRsaService } from '@walnut-server/cache'
import type { IWalnutAdminKeyStore } from '@walnut-server/rsa'
import { Buffer } from 'node:buffer'
import { constants, createCipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto'

import { SecurityRsaService } from '@walnut-server/rsa'
import { describe, expect, it, vi } from 'vitest'

import { WalnutAdminInterceptorRequestDecrypt } from '../decrypt.interceptor'

/**
 * q10「信封最后一公里」的单测（机制层，不起 Nest）。
 *
 * 钉三件事：
 * 1. 信封识别（`isCipherEnvelope`）只认 admin `encryptRequestValue` 的 wire 形状；
 * 2. **解密后的明文真的换掉 `request.body`**（旧实现只写 `_decryptedBody`，
 *    `@Body()` + ValidationPipe 拿到密文）；
 * 3. 非信封值原样透传（灰度期兼容），信封解不开时异常向上冒（40011 语义由 rsa.service 保证）。
 */

interface ShimRequest {
  isPostman: boolean
  method: string
  url: string
  body: Record<string, unknown>
  _decryptedBody?: Record<string, unknown>
}

let currentRequest: ShimRequest

function makeRequest(body: Record<string, unknown>): ShimRequest {
  return {
    isPostman: false,
    method: 'PATCH',
    url: '/api/v1/system/user/lock/preference',
    body,
  }
}

/** reflector 的桩：直接返回装饰器登记的字段（与 @WalnutAdminDecoratorDecryptRequest 同语义） */
function makeContext() {
  return {
    switchToHttp: () => ({ getRequest: () => currentRequest }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never
}

function makeInterceptor(fields: string | string[], decrypt: (v: string) => Promise<string>) {
  const reflector = { getAllAndOverride: () => fields }
  const rsa = { decryptRequestValueWIthServerRsaPrivKey: vi.fn(decrypt) }
  const interceptor = new WalnutAdminInterceptorRequestDecrypt(reflector as never, rsa as never)
  return { interceptor, rsa }
}

const noopHandler = { handle: () => ({ pipe: () => 'ok' }) } as never

/** 与 admin `encryptRequestValue` 同形的信封（只造形状，内容不必真加密） */
function fakeEnvelope() {
  return Buffer.from(JSON.stringify({
    enc: 'AES_256_GCM',
    key: Buffer.from('k'.repeat(256)).toString('base64'),
    iv: Buffer.from('i'.repeat(12)).toString('base64'),
    ct: Buffer.from('cipher').toString('base64'),
    tag: Buffer.from('t'.repeat(16)).toString('base64'),
  })).toString('base64')
}

describe('拦截器 WalnutAdminInterceptorRequestDecrypt（信封最后一公里）', () => {
  it('isCipherEnvelope 只认 AES_256_GCM 五字段形状', () => {
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope(fakeEnvelope())).toBe(true)
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope('plain-password')).toBe(false)
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope('')).toBe(false)
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope(null)).toBe(false)
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope(123)).toBe(false)
    // base64(JSON) 但 enc 不对 / 缺 tag
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope(
      Buffer.from(JSON.stringify({ enc: 'AES_256_CBC', key: 'k', iv: 'i', ct: 'c', tag: 't' })).toString('base64'),
    )).toBe(false)
    expect(WalnutAdminInterceptorRequestDecrypt.isCipherEnvelope(
      Buffer.from(JSON.stringify({ enc: 'AES_256_GCM', key: 'k', iv: 'i', ct: 'c' })).toString('base64'),
    )).toBe(false)
  })

  it('解密后 request.body 被明文替换（@Body()/ValidationPipe 的取值源）', async () => {
    const envelope = fakeEnvelope()
    currentRequest = makeRequest({ lockPwdHash: envelope, lockMode: 'security' })

    const { interceptor, rsa } = makeInterceptor(['lockPwdHash'], async () => 'plain-pwd-1')
    await interceptor.intercept(makeContext(), noopHandler)

    expect(rsa.decryptRequestValueWIthServerRsaPrivKey).toHaveBeenCalledTimes(1)
    expect(rsa.decryptRequestValueWIthServerRsaPrivKey).toHaveBeenCalledWith(envelope)

    expect(currentRequest.body).toEqual({ lockPwdHash: 'plain-pwd-1', lockMode: 'security' })
    // 兼容通道同步更新
    expect(currentRequest._decryptedBody).toEqual(currentRequest.body)
  })

  it('非信封值原样透传，不调用解密（灰度期兼容）', async () => {
    currentRequest = makeRequest({ lockPwdHash: 'plain-pwd-1', lockMode: 'security' })

    const { interceptor, rsa } = makeInterceptor(['lockPwdHash'], async () => 'should-not-be-used')
    await interceptor.intercept(makeContext(), noopHandler)

    expect(rsa.decryptRequestValueWIthServerRsaPrivKey).not.toHaveBeenCalled()
    expect(currentRequest.body.lockPwdHash).toBe('plain-pwd-1')
  })

  it('信封解不开时异常向上冒', async () => {
    const envelope = fakeEnvelope()
    currentRequest = makeRequest({ lockPwdHash: envelope })

    const { interceptor } = makeInterceptor(['lockPwdHash'], async () => {
      throw new Error('boom')
    })

    await expect(interceptor.intercept(makeContext(), noopHandler)).rejects.toThrow()

    // body 未被半途改写（失败请求不应留下「部分解密」的中间态）
    expect(currentRequest.body.lockPwdHash).toBe(envelope)
  })

  it('多字段：只有信封字段被解，非信封字段保持原值', async () => {
    currentRequest = makeRequest({ lockPwdHash: fakeEnvelope(), other: 'keep' })

    const { interceptor } = makeInterceptor(['lockPwdHash', 'other'], async () => 'plain')
    await interceptor.intercept(makeContext(), noopHandler)

    expect(currentRequest.body).toEqual({ lockPwdHash: 'plain', other: 'keep' })
  })

  it('isPostman 请求跳过解密（dev 噪声过滤，非安全边界）', async () => {
    const envelope = fakeEnvelope()
    currentRequest = makeRequest({ lockPwdHash: envelope })
    currentRequest.isPostman = true

    const { interceptor, rsa } = makeInterceptor(['lockPwdHash'], async () => 'plain')
    await interceptor.intercept(makeContext(), noopHandler)

    expect(rsa.decryptRequestValueWIthServerRsaPrivKey).not.toHaveBeenCalled()
    expect(currentRequest.body.lockPwdHash).toBe(envelope)
  })
})

/**
 * rsa.service 的真实加解密往返（含错误收敛到 40011）—— 它才是「与 admin 信封互逆」的
 * 权威判据。这里不依赖 Redis / DB：keyStore 用内存桩，RSA 密钥现场生成。
 */
describe('securityRsaService.decryptRequestValueWIthServerRsaPrivKey（wire 互逆）', () => {
  it('rsa-oaep-sha256 + aes-256-gcm 信封可还原；任何坏输入都是 40011', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })

    const cacheRsaService = { getRsaPubKeyCache: vi.fn(async () => publicKey) }
    const keyStore: IWalnutAdminKeyStore = {
      getCurrent: vi.fn(async () => ({ publicKeyPem: publicKey })),
      getCurrentActiveKey: vi.fn(async () => ({ meta: { privateKeyPem: privateKey } })),
    }

    const service = new SecurityRsaService(
      cacheRsaService as unknown as AppTechCacheRsaService,
      keyStore,
    )

    // —— 客户端侧（与 admin crypto.ts 逐字节同构）——
    const aesKey = randomBytes(32)
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
    const ct = Buffer.concat([cipher.update('pin-123456', 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const key = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, aesKey)
    const envelope = Buffer.from(JSON.stringify({
      enc: 'AES_256_GCM',
      key: key.toString('base64'),
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: tag.toString('base64'),
    })).toString('base64')

    await expect(service.decryptRequestValueWIthServerRsaPrivKey(envelope)).resolves.toBe('pin-123456')

    // 坏输入全部收敛 40011（不是 50000）
    for (const bad of [
      '',
      'not-an-envelope',
      Buffer.from('{"enc":"AES_256_GCM"}').toString('base64'),
      Buffer.from(JSON.stringify({ enc: 'AES_256_GCM', key: key.toString('base64'), iv: 'AA==', ct: 'AA==', tag: 'AA==' })).toString('base64'),
    ]) {
      await expect(service.decryptRequestValueWIthServerRsaPrivKey(bad)).rejects.toMatchObject({ response: { errCode: 40011 } })
    }

    // RSA 私钥缺失同样 40011
    keyStore.getCurrentActiveKey = vi.fn(async () => ({ meta: {} }))
    await expect(service.decryptRequestValueWIthServerRsaPrivKey(envelope)).rejects.toMatchObject({ response: { errCode: 40011 } })

    // 旁证：私钥确实能解（上面的失败不是「整条链路都坏」）
    expect(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key)).toHaveLength(32)
  })
})
