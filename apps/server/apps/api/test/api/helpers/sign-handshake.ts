import { Buffer } from 'node:buffer'
import { constants, createDecipheriv, createHash, createHmac, generateKeyPairSync, hkdfSync, privateDecrypt, randomBytes } from 'node:crypto'

import { objectToPaths } from '@walnut-server/utils/general'

/**
 * 签名握手与 HMAC 计算的**客户端侧复刻**（API 级测试助手）。
 *
 * 规则逐条对照服务端实现抄写，不 mock 服务端：
 * - 签名原文：`apps/server/libs/guards/src/guards/sign.guard.ts` 的 `buildSignRaw` ——
 *   `METHOD|PATH(去API前缀)|扁平化body排序串|timestamp=xx|nonce=xx|ua=xx`；
 *   扁平化直接复用服务端同一纯函数 `objectToPaths`（@walnut-server/utils/general），
 *   保证双端对同一 body 产出逐字节一致的展开结果；
 * - 单因子 HMAC（未登录）：`HMAC-SHA256(raw, aesKey)`，key 为握手 base64url 串的 UTF-8 字节；
 * - 双因子 HMAC（已登录）：`sessionDerivedKey = HKDF-SHA256(
 *   ikm = SHA256(sessionKey 原始字节), salt = aesKey, info = hkdfInfo, len = 32)`，
 *   对照 `apps/server/libs/auth/src/modules/session/session.service.ts` 的 `deriveApiSignKey`（sessionKey
 *   从 login/finish 响应来，base64 编码；服务端只存 SHA256 hash，客户端持有原值）；
 * - 握手第二步的 aesKey 信封解密：对照 `libs/rsa/src/rsa.service.ts` 的
 *   `encryptResponseValueWithClientRsaPubKey` —— 服务端用客户端 RSA 公钥（握手 initial
 *   提交的）包一层一次性 AES-256-GCM（key|iv|tag 60 字节 blob，RSA-OAEP-SHA256），
 *   客户端用配套私钥还原；
 * - CAP PoW 求解：对照 `@cap.js/server` 的 `prng`（fnv1a + xorshift32 → hex 串）与
 *   `redeemChallenge` 的校验式 `sha256(salt + n).startsWith(target)` —— challenge
 *   响应只给 `{c,s,d}` 参数，salt/target 由 token 确定性推导，客户端自算解。
 */

/** 与白名单兼容的真实浏览器 UA（security.guard 校验 os/browser 白名单，缺 UA 直接判 suspicious） */
export const WALNUT_TEST_USER_AGENT
  = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

export interface WalnutClientRsaKeyPair {
  publicKeyPem: string
  privateKeyPem: string
}

export function generateClientRsaKeyPair(): WalnutClientRsaKeyPair {
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

/**
 * 签名原文组装（对照 sign.guard buildSignRaw —— 顺序与拼接符逐字对齐）
 */
export function buildSignRaw(params: {
  method: string
  /** 已去掉 `/{prefix}/v{version}` 前缀的路由路径（含 query 串，与 req.url 同形） */
  routePath: string
  body: unknown
  timestamp: number
  nonce: string
  ua: string
}): string {
  const { method, routePath, body, timestamp, nonce, ua } = params

  // 1. 扁平化 Request 体并排序（objectToPaths 是双端共用的纯函数）
  const flattenObj = objectToPaths((body ?? {}) as never)
  const sortedParams = Object.keys(flattenObj)
    .sort()
    .map(k => `${k}=${flattenObj[k]}`)
    .join('&')

  // 2. 组装签名原文（多因子）
  return [
    method.toUpperCase(),
    routePath === '' ? '/' : routePath,
    sortedParams,
    `timestamp=${timestamp}`,
    `nonce=${nonce}`,
    `ua=${ua}`,
  ].join('|')
}

/** 单因子签名（未登录）：HMAC-SHA256(raw, aesKey)，key 为 base64url 串的 UTF-8 字节 */
export function computeSingleFactorSign(raw: string, aesKey: string): string {
  return createHmac('sha256', aesKey).update(raw, 'utf8').digest('hex')
}

/**
 * 双因子签名密钥派生（对照 session.service deriveApiSignKey）：
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
