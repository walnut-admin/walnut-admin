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
import {
  constants,
  createDecipheriv,
  createHash,
  createHmac,
  generateKeyPairSync,
  hkdfSync,
  privateDecrypt,
  randomBytes,
} from 'node:crypto'

/** 与安全 guard 白名单兼容的真实 Chrome UA（必须与请求头 `user-agent` 逐字一致） */
export const SIGN_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36'

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
export function deriveApiSignKey(
  sessionKeyBase64: string,
  aesKey: string,
  hkdfInfo: string,
): Buffer {
  const authSessionKey = Buffer.from(sessionKeyBase64, 'base64')
  const authSessionKeyHash = createHash('sha256').update(authSessionKey).digest()

  return Buffer.from(
    hkdfSync(
      'sha256',
      authSessionKeyHash,
      Buffer.from(aesKey, 'utf8'),
      Buffer.from(hkdfInfo, 'utf8'),
      32,
    ),
  )
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

  return Buffer.concat([
    decipher.update(Buffer.from(payload.cipher, 'base64')),
    decipher.final(),
  ]).toString('utf8')
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
 * CAP 求解的熔断上界（**异常配置的保险丝，不是正常路径**）。
 *
 * - 每问次数上界 = `max(1_000_000, 16^d * 32)`：difficulty=d 时期望尝试 16^d 次，留 32 倍余量
 *   （d=4 ⇒ 2_097_152）；小 difficulty 用 1_000_000 兜底，避免上界比期望还小。
 * - 总墙钟上界 30s：起点在问题循环之外，覆盖全部 count 问。
 * - 问题数 / difficulty 的形态在进循环前校验（count 1..50、difficulty 1..8）。
 */
const CAP_SOLVE_WALL_CLOCK_MS = 30_000
const MAX_CAP_QUESTIONS = 50
const MIN_CAP_DIFFICULTY = 1
const MAX_CAP_DIFFICULTY = 8

function maxAttemptsPerQuestion(difficulty: number): number {
  return Math.max(1_000_000, 16 ** difficulty * 32)
}

/** 求解前的形态校验：配置被改坏时立刻失败，而不是在死循环里等墙钟 */
function assertCapChallenge(challenge: { c: number; s: number; d: number }): void {
  if (!Number.isInteger(challenge.c) || challenge.c < 1 || challenge.c > MAX_CAP_QUESTIONS) {
    throw new Error(
      `[e2e/cap] challenge.c=${challenge.c} 不合法（期望 1..${MAX_CAP_QUESTIONS} 的整数）——CAP 配置异常`,
    )
  }
  if (
    !Number.isInteger(challenge.d) ||
    challenge.d < MIN_CAP_DIFFICULTY ||
    challenge.d > MAX_CAP_DIFFICULTY
  ) {
    throw new Error(
      `[e2e/cap] challenge.d=${challenge.d} 不合法（期望 ${MIN_CAP_DIFFICULTY}..${MAX_CAP_DIFFICULTY} 的整数）——CAP 配置异常`,
    )
  }
}

/**
 * CAP challenge PoW 求解（对照 @cap.js/server redeemChallenge 的校验式）：
 * 第 i 问 salt = prng(token+i, s)、target = prng(token+i+'d', d)，
 * 求最小 n 使 sha256(salt + n) 的 hex 以 target 开头。
 *
 * 上界是**异常配置的熔断**，不是正常路径：challenge 的 `c` / `d` / `s` 来自
 * `app.global.capjs.config`（seed 默认 count 10 / difficulty 4 ⇒ 每问期望 16^4 ≈ 6.5 万次哈希；
 * E2E 封板库由 `scripts/prepare-db.ts` 放宽到 difficulty 2 ⇒ 每问期望 256 次，整轮毫秒级）。
 * 若配置被改坏（count / difficulty 被放大），没有上界就会在用例的 120s 超时里挂死、还说不清
 * 卡在哪一问 —— 这里主动熔断并报告 index / c / s / d / attempts，让失败可读。
 */
export function solveCapChallenge(
  challenge: { c: number; s: number; d: number },
  token: string,
): number[] {
  assertCapChallenge(challenge)

  const solutions: number[] = []
  const startedAt = Date.now()
  const attemptLimit = maxAttemptsPerQuestion(challenge.d)

  for (let i = 1; i <= challenge.c; i++) {
    const salt = capPrng(`${token}${i}`, challenge.s)
    const target = capPrng(`${token}${i}d`, challenge.d)

    let n = 0
    for (;;) {
      const hash = createHash('sha256')
        .update(salt + String(n))
        .digest('hex')
      if (hash.startsWith(target)) {
        solutions.push(n)
        break
      }
      n++
      if (n > attemptLimit) {
        throw new Error(
          `[e2e/cap] 第 ${i} 问超过尝试上界（index=${i} c=${challenge.c} s=${challenge.s} d=${challenge.d} attempts=${n}）` +
            ` —— 每问上界 ${attemptLimit}，通常意味着 CAP 配置异常，不是正常求解路径`,
        )
      }
      if (Date.now() - startedAt > CAP_SOLVE_WALL_CLOCK_MS) {
        throw new Error(
          `[e2e/cap] 求解超过墙钟上界（index=${i} c=${challenge.c} s=${challenge.s} d=${challenge.d} attempts=${n}` +
            ` elapsedMs=${Date.now() - startedAt}）—— 上界 ${CAP_SOLVE_WALL_CLOCK_MS}ms，通常意味着 CAP 配置异常`,
        )
      }
    }
  }

  return solutions
}
