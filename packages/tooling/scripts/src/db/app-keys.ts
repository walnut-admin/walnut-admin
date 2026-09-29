/**
 * `app_key` 的**现生成**逻辑 —— 为什么不是把库里的密钥导出进仓。
 *
 * 用户的导出里那一列是真东西：每个 `RSA_PAIR` 的 `meta.privateKeyPem` 是完整的 2048 位私钥 PEM
 * （1704 字符），AES 那几条是 32 字节 `keyB64`，含当前 ACTIVE 的那一套。把作者的真私钥提交进
 * 公开仓有两重代价：泄密；以及**本仓自己的 `lint:secrets` 会直接判红**（凭据形状不许进仓库）。
 *
 * 而"全新库开箱可用"这个目标并不需要那套密钥 —— 每个安装各自生成一套反而更对（`app_key` 是
 * 请求签名/加密的密钥表，共用一套意味着所有安装同密钥）。所以 seed 只带**生成规则**，密钥由
 * 播种时现生成。
 *
 * 形状对齐的是**当前库里的真实文档**（2026-09-29 实测导出的 ACTIVE 第 6 版）与
 * `apps/server/apps/api/src/modules/app/key/schema/key.schema.ts`：
 *
 * | 字段 | AES 那条 | RSA 那条 |
 * |------|----------|----------|
 * | `key` | `aes_key_url-<epochMs>` | `rsa_pair-<epochMs>` |
 * | `type` | `AES_KEY_URL` | `RSA_PAIR` |
 * | `meta` | `{ keyB64, bits: 256, cipher: 'AES-256-GCM' }` | `{ publicKeyPem, privateKeyPem, bits: 2048, cipher: 'AES-256-GCM' }` |
 *
 * 有效期与真实数据一致取 **30 天**（导出的 `validStart`/`validEnd` 就是 30 天窗口，轮换 cron
 * 按 `validEnd` 判断）。**这里刻意不重复后端的生成逻辑**（那条路要起 Nest 上下文才能调到，
 * 而工具链包不能依赖后端的路径别名与装饰器）—— 代价是形状可能漂移，所以配了一条用例钉住形状。
 */
import { generateKeyPairSync, randomBytes } from 'node:crypto'

/** 与库中真实文档一致的有效期窗口（天） */
export const KEY_VALID_DAYS = 30

/** 与后端 `AppKeyTypeConst` 一致的两个取值 */
export type AppKeyType = 'AES_KEY_URL' | 'RSA_PAIR'

export interface AppKeyDoc {
  key: string
  type: AppKeyType
  version: number
  status: 'ACTIVE'
  validStart: Date
  validEnd: Date
  rotateAfter: null
  meta: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

/** 生成一条 AES 密钥文档（32 字节 → base64 恰好 44 字符，与库里那 6 条一致） */
export function generateAesKey(now = new Date(), version = 1): AppKeyDoc {
  return {
    key: `aes_key_url-${now.getTime()}`,
    type: 'AES_KEY_URL',
    version,
    status: 'ACTIVE',
    validStart: now,
    validEnd: addDays(now, KEY_VALID_DAYS),
    rotateAfter: null,
    meta: {
      keyB64: randomBytes(32).toString('base64'),
      bits: 256,
      cipher: 'AES-256-GCM',
    },
    createdAt: now,
    updatedAt: now,
  }
}

/** 生成一条 RSA 密钥对文档（2048 位，SPKI 公钥 / PKCS#8 私钥，与库里那 6 条一致） */
export function generateRsaKey(now = new Date(), version = 1): AppKeyDoc {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  })
  return {
    key: `rsa_pair-${now.getTime()}`,
    type: 'RSA_PAIR',
    version,
    status: 'ACTIVE',
    validStart: now,
    validEnd: addDays(now, KEY_VALID_DAYS),
    rotateAfter: null,
    meta: { publicKeyPem: publicKey, privateKeyPem: privateKey, bits: 2048, cipher: 'AES-256-GCM' },
    createdAt: now,
    updatedAt: now,
  }
}

/** 一套 ACTIVE 密钥（AES + RSA），顺序固定便于测试与日志 */
export function generateAppKeys(now = new Date()): AppKeyDoc[] {
  return [generateAesKey(now, 1), generateRsaKey(now, 1)]
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}
