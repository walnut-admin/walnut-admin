import type { ConfigService } from '@nestjs/config'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { AppTechCryptoService } from '../crypto.service'

/**
 * `AppTechCryptoService`（AES-256-GCM 文本加解密 + HMAC 查找键）的针对性用例。
 *
 * 这里钉的是**契约**而不是实现细节：
 * - 密文是 `iv || ciphertext || authTag` 的自描述串，加解密必须自洽往返；
 * - AAD 是认证数据的一部分 —— 加密时给了 AAD，解密不给就必须失败（否则「附加」认证
 *   就等于没认证，跨租户重放会穿过去）；
 * - 任何一位被篡改都要抛，而不是返回半截明文；
 * - `hash` 是**不可逆查找键**（盐由调用方给），同盐同值必须同哈希，否则按
 *   `value_hash` 等值查找永远 miss（见 `user_identity.shared.service.ts` 的
 *   `generateValueHash`）。
 *
 * 注：本类曾有一个 `verifyHash`（time-safe 重算比较），全仓零调用方、`value_hash`
 * 只当 SQL 等值查找键用，已删除 —— 需要重算比较时另立新方法，别复活它。
 */

const ENCRYPT_KEY_NAME = 'TEST_AES_KEY'
const RAW_KEY = randomBytes(32)
const KEY_B64 = RAW_KEY.toString('base64')

function createService(overrides: Record<string, string | null | undefined> = {}): AppTechCryptoService {
  const values: Record<string, string | null | undefined> = {
    [ENCRYPT_KEY_NAME]: KEY_B64,
    ...overrides,
  }
  const configService = {
    get: (key: string) => values[key],
  } as unknown as ConfigService
  return new AppTechCryptoService(configService)
}

describe('appTechCryptoService', () => {
  describe('encrypt / decrypt', () => {
    it('原样往返（无 AAD）', () => {
      const service = createService()
      const plain = 'walnut-admin 的明文，含中文与 emoji 🔐'

      const encrypted = service.encrypt(plain, ENCRYPT_KEY_NAME)

      expect(encrypted).not.toBe(plain)
      expect(service.decrypt(encrypted, ENCRYPT_KEY_NAME)).toBe(plain)
    })

    it('原样往返（带 AAD）', () => {
      const service = createService()
      const plain = 'tenant-scoped payload'
      const aad = 'tenant:walnut'

      const encrypted = service.encrypt(plain, ENCRYPT_KEY_NAME, aad)

      expect(service.decrypt(encrypted, ENCRYPT_KEY_NAME, aad)).toBe(plain)
    })

    it('解密时缺 AAD 必须失败（AAD 真的参与了认证）', () => {
      const service = createService()
      const encrypted = service.encrypt('payload', ENCRYPT_KEY_NAME, 'tenant:walnut')

      expect(() => service.decrypt(encrypted, ENCRYPT_KEY_NAME)).toThrow()
    })

    it('认证数据（AAD）不一致必须失败', () => {
      const service = createService()
      const encrypted = service.encrypt('payload', ENCRYPT_KEY_NAME, 'tenant:a')

      expect(() => service.decrypt(encrypted, ENCRYPT_KEY_NAME, 'tenant:b')).toThrow()
    })

    it('随机 IV：同一明文两次加密的密文不同', () => {
      const service = createService()

      const first = service.encrypt('same plaintext', ENCRYPT_KEY_NAME)
      const second = service.encrypt('same plaintext', ENCRYPT_KEY_NAME)

      expect(first).not.toBe(second)
      // 但都必须解得回同一个明文
      expect(service.decrypt(first, ENCRYPT_KEY_NAME)).toBe('same plaintext')
      expect(service.decrypt(second, ENCRYPT_KEY_NAME)).toBe('same plaintext')
    })

    it('密文被篡改必须抛错，而不是返回半截明文', () => {
      const service = createService()
      const encrypted = service.encrypt('tamper me', ENCRYPT_KEY_NAME)
      const bytes = Buffer.from(encrypted, 'base64')
      // 改密文体里的一个字节（跳过 12 字节 IV）
      bytes[12] ^= 0xFF
      const tampered = bytes.toString('base64')

      expect(() => service.decrypt(tampered, ENCRYPT_KEY_NAME)).toThrow()
    })

    it('长度不足 iv + authTag 的输入直接抛错', () => {
      const service = createService()

      expect(() => service.decrypt(Buffer.from('short').toString('base64'), ENCRYPT_KEY_NAME)).toThrow(
        /too short/,
      )
    })
  })

  describe('hash（不可逆查找键）', () => {
    it('同盐同值 → 同哈希（等值查找的前提）', () => {
      const service = createService()

      expect(service.hash('13800000000', 'salt-a')).toBe(service.hash('13800000000', 'salt-a'))
    })

    it('异盐或异值 → 异哈希', () => {
      const service = createService()

      expect(service.hash('13800000000', 'salt-a')).not.toBe(service.hash('13800000000', 'salt-b'))
      expect(service.hash('13800000000', 'salt-a')).not.toBe(service.hash('13800000001', 'salt-a'))
    })

    it('默认 hex 输出 64 字符（sha256）', () => {
      const service = createService()

      expect(service.hash('value', 'salt-a')).toMatch(/^[0-9a-f]{64}$/)
    })

    it('显式 base64 编码与 hex 表示同一摘要', () => {
      const service = createService()

      const hex = service.hash('value', 'salt-a', 'hex')
      const b64 = service.hash('value', 'salt-a', 'base64')

      expect(Buffer.from(hex, 'hex').toString('base64')).toBe(b64)
    })

    it('不给盐时每次随机加盐（同值不同哈希）', () => {
      const service = createService()

      expect(service.hash('value')).not.toBe(service.hash('value'))
    })
  })

  describe('generateKey / generateSalt', () => {
    it('generateKey 产出 32 字节的 base64（AES-256 的密钥宽度）', () => {
      const service = createService()

      expect(Buffer.from(service.generateKey(), 'base64')).toHaveLength(32)
    })

    it('generateSalt 产出 32 字节的 base64 且每次不同', () => {
      const service = createService()

      const first = service.generateSalt()

      expect(Buffer.from(first, 'base64')).toHaveLength(32)
      expect(first).not.toBe(service.generateSalt())
    })
  })
})
