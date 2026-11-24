/**
 * 签名握手 / CAP 求解的**客户端侧**（从 `apps/server/apps/api/test/api/helpers/sign-handshake.ts`
 * 移植；该文件的注释是逐条对照服务端实现的原始依据）。
 *
 * 与那份 helper 的差异只有两处，都是为了不复制真源：
 * - 签名原文用 `@walnut/utils/sign-raw` 的 `buildSignRaw` —— 它就是服务端 sign.guard 用的
 *   同一份纯函数（双端逐字节同源），不再手抄拼接规则；
 * - 本文件不依赖 Nest / supertest：cookie jar 与 HTTP 由 lib/protocol/client.ts 负责。
 *
 * 其余算法（RSA 握手信封 / 单双因子 HMAC / HKDF 派生 / CAP PoW）仍与 helper 逐字一致：
 * 它们是协议，不是「我们自己定的规则」—— 照抄服务端才是唯一正确做法。
 */
import { Buffer } from 'node:buffer'
import { constants, createDecipheriv, createHash, createHmac, generateKeyPairSync, hkdfSync, privateDecrypt, randomBytes } from 'node:crypto'

/** 与安全 guard 白名单兼容的真实 Chrome UA（必须与请求头 `user-agent` 逐字一致） */
export const SIGN_USER_AGENT
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

export interface ClientRsaKeyPair {
  publicKeyPem: string
  privateKeyPem: string
}

export function generateClientRsaKeyPair(): ClientRsaKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return { publicKeyPem: publicKey, privateKeyPem: privateKey }
}

/** 32 位十六进制 nonce（sign.guard 的 NONCE_REGEX） */
export function generateNonce(): string {
  return randomBytes(16).toString('hex')
}

/** 单因子签名（未登录）：HMAC-SHA256(raw, aesKey)，key 为 base64url 串的 UTF-8 字节 */
export function computeSingleFactorSign(raw: string, aesKey: string): string {
  return createHmac('sha256', aesKey).update(raw, 'utf8').digest('hex')
}

/**
 * 双因子签名密钥派生（对照 session.service 的 deriveApiSignKey）：
 * HKDF-SHA256(ikm = SHA256(sessionKey 原始字节), salt = aesKey, info = hkdfInfo, 32)
 */
export function deriveApiSignKey(sessionKeyBase64: string, aesKey: string, hkdfInfo: string): Buffer {
  const authSessionKey = Buffer.from(sessionKeyBase64, 'base64')
  const authSessionKeyHash = createHash('sha256').update(authSessionKey).digest()

  return Buffer.from(hkdfSync(
    'sha256',
    authSessionKeyHash,
    Buffer.from(aesKey, 'utf8'),
    Buffer.from(hkdfInfo, 'utf8'),
    32,
  ))
}

/** 双因子签名（已登录）：HMAC-SHA256(raw, derivedKey) */
export function computeDualFactorSign(raw: string, derivedKey: Buffer): string {
  return createHmac('sha256', Buffer.from(new Uint8Array(derivedKey)))
    .update(raw, 'utf8')
    .digest('hex')
}

/**
 * 解握手第二步的 aesKey 信封（rsa.service encryptResponseValueWithClientRsaPubKey 的逆）：
 * envelope = base64(JSON{ cipher: base64, key: base64 })，key = RSA-OAEP-SHA256(aesKey|iv|tag)
 */
export function decryptAesKeyEnvelope(privateKeyPem: string, envelopeBase64: string): string {
  const payload = JSON.parse(Buffer.from(envelopeBase64, 'base64').toString('utf8')) as {
    cipher: string
    key: string
  }

  const keyBlob = privateDecrypt(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    Buffer.from(payload.key, 'base64'),
  )

  // 60 字节 blob：aesKey(32) | iv(12) | tag(16)
  const aesKeyBytes = keyBlob.subarray(0, 32)
  const iv = keyBlob.subarray(32, 44)
  const tag = keyBlob.subarray(44, 60)

  const decipher = createDecipheriv('aes-256-gcm', aesKeyBytes, iv)
  decipher.setAuthTag(tag)

  return Buffer.concat([decipher.update(Buffer.from(payload.cipher, 'base64')), decipher.final()]).toString('utf8')
}

/** cap.js prng 复刻：fnv1a 种子 + xorshift32，hex 拼接后截断 */
function capPrng(seed: string, length: number): string {
  function fnv1a(str: string): number {
    let hash = 2166136261
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i)
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }
    return hash >>> 0
  }

  let state = fnv1a(seed)
  let result = ''

  const next = () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }

  while (result.length < length) {
    const rnd = next()
    result += rnd.toString(16).padStart(8, '0')
  }

  return result.substring(0, length)
}

/**
 * CAP challenge PoW 求解（对照 @cap.js/server redeemChallenge 的校验式）：
 * 第 i 问 salt = prng(token+i, s)、target = prng(token+i+'d', d)，
 * 求最小 n 使 sha256(salt + n) 的 hex 以 target 开头。
 */
export function solveCapChallenge(
  challenge: { c: number, s: number, d: number },
  token: string,
): number[] {
  const solutions: number[] = []

  for (let i = 1; i <= challenge.c; i++) {
    const salt = capPrng(`${token}${i}`, challenge.s)
    const target = capPrng(`${token}${i}d`, challenge.d)

    let n = 0
    for (;;) {
      const hash = createHash('sha256').update(salt + String(n)).digest('hex')
      if (hash.startsWith(target)) {
        solutions.push(n)
        break
      }
      n++
    }
  }

  return solutions
}
