import { Buffer } from 'node:buffer'
import {
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'
import { Injectable, Logger } from '@nestjs/common'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut/const/app/cache'
import { isNil } from 'lodash'
import { AppTokenService } from '@/modules/shared/token/token.service'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

/**
 * Auth Session 存储结构
 *
 * ⚠️ 生产环境必须使用 Redis 并启用持久化
 */
interface AuthSession {
  /**
   * Session Key �?SHA-256 哈希值（32 字节 Buffer�?
   *
   * 为什么存�?hash 而不是明文？
   * 1. 即使 Redis 被入侵，攻击者也无法恢复原始 session key
   * 2. 符合 "密钥派生" 原则：高熵密�?-> 派生多个子密�?
   * 3. 使用 timingSafeEqual 防止时序攻击
   */
  authSessionKeyHash: Buffer

  /**
   * 可选：会话元数�?
   */
  createdAt?: number
  lastAccessAt?: number
}

/**
 * Auth Session 服务
 *
 * 职责�?
 * 1. 管理用户登录会话的生命周�?
 * 2. 存储和验�?Session Key（OPAQUE 协议产生的共享密钥）
 * 3. 派生用于 API 签名的子密钥（HKDF�?
 * 4. 提供会话吊销能力（主动踢下线 / 风控�?
 *
 * 安全设计�?
 * - Session Key 仅在创建时返回一次，后续只存储其 hash
 * - 使用 HKDF 派生子密钥，不同用途使用不同的 info 参数
 * - 使用 timingSafeEqual 防止时序攻击
 * - 支持按设备、按用户批量吊销会话
 */
@Injectable()
export class AuthSessionService {
  private readonly logger = new Logger(AuthSessionService.name)

  /**
   * TODO remove
   * HKDF 派生�?info 参数（用于不同目的的密钥派生�?
   */
  private readonly HKDF_INFO = {
    API_SIGN: Buffer.from('walnut-admin-api-sign-v1', 'utf8'),
    // 可扩展：
    // ENCRYPTION: Buffer.from('walnut-admin-encryption-v1'),
    // WEBSOCKET: Buffer.from('walnut-admin-websocket-v1'),
  }

  constructor(
    private readonly cacheService: AppTechCacheService,
    private readonly tokenService: AppTokenService,
    private readonly appSettingCahceService: AppTechCacheAppSettingsService,
  ) { }

  /**
   * 生成 Session Cache Key
   *
   * 格式: auth:sessions:{userId}:{deviceId}:{sessionId}
   *
   * 设计说明�?
   * - 支持�?userId �?deviceId 批量删除（使�?pattern 匹配�?
   * - sessionId 作为最细粒度的标识�?
   */
  private getCacheKey(userId: string, deviceId: string, sessionId: string): string {
    return `${WalnutAdminConstAppCacheKeys.AUTH_SESSIONS}:${userId}:${deviceId}:${sessionId}`
  }

  /**
   * 延长会话 TTL（保持会话活跃）
   *
   * 使用场景�?
   * - 每次 API Request通过签名验证后调�?
   * - 确保活跃用户的会话不会过�?
   *
   * @param userId User ID
   * @param deviceId Device ID
   * @param sessionId 会话 ID
   */
  async touchAuthSessionTTL(
    userId: string,
    deviceId: string,
    sessionId: string,
  ): Promise<void> {
    const ttl = this.tokenService.getRefreshTokenExpireSeconds()
    const cacheKey = this.getCacheKey(userId, deviceId, sessionId)

    await this.cacheService.expire(
      cacheKey,
      ttl,
    )

    this.logger.debug(`Auth session TTL touched: user=${userId}, device=${deviceId}, session=${sessionId}`)
  }

  /**
   * 创建登录会话
   *
   * 使用场景�?
   * - 用户登录成功后调用（OPAQUE login finish�?
   * - 获得 OPAQUE 协议产生�?session key
   *
   * @param userId User ID
   * @param deviceId Device ID
   * @param sessionKeyMaterial Session Key 材料
   *        - OPAQUE: login finish �?session key（string / Buffer�?
   *        - 其他认证方式: randomBytes(32)
   * @returns sessionId �?authSessionKey（⚠�?仅返回一次）
   */
  async createAuthSession(
    userId: string,
    deviceId: string,
    sessionKeyMaterial: Buffer | string = randomBytes(32).toString('base64'),
  ): Promise<{
    sessionId: string
    authSessionKey: Buffer // ⚠️ 仅返回一次，客户端需要妥善保?
  }> {
    // 1. 生成随机 Session ID
    const sessionId = randomSessionId()

    // 2. 规范�?Session Key �?Buffer
    const authSessionKey = normalizeToBuffer(sessionKeyMaterial)

    // 3. 计算 Session Key 的哈希值（存储�?Redis�?
    const authSessionKeyHash = hash(authSessionKey)

    // 4. 构建会话数据
    const session: AuthSession = {
      authSessionKeyHash,
      createdAt: Date.now(),
      lastAccessAt: Date.now(),
    }

    // 5. 存储�?Cache
    const ttl = this.tokenService.getRefreshTokenExpireSeconds()

    await this.cacheService.set(
      this.getCacheKey(userId, deviceId, sessionId),
      session,
      {
        t: WalnutAdminConstAppCacheType.AUTH,
        ttl,
      },
    )

    this.logger.log(
      `Auth session created: user=${userId}, device=${deviceId}, session=${sessionId}, ttl=${ttl}s`,
    )

    // 6. 返回 sessionId 和原�?authSessionKey（⚠�?仅此一次）
    return {
      sessionId,
      authSessionKey, // 客户端需要存储此 key 用于后续签名
    }
  }

  /**
   * 获取 Auth Session Key Hash
   *
   * 内部使用：用于密钥派生和验证
   *
   * @returns Session Key �?SHA-256 哈希值（Buffer�?
   */
  async getAuthSessionKeyHash(
    userId: string,
    deviceId: string,
    sessionId: string,
  ): Promise<Buffer | null> {
    try {
      const session = await this.cacheService.get<AuthSession>(
        this.getCacheKey(userId, deviceId, sessionId),
      )

      if (isNil(session)) {
        this.logger.warn(
          `Auth session not found: user=${userId}, device=${deviceId}, session=${sessionId}`,
        )
        return null
      }

      return session.authSessionKeyHash
    }
    catch (error: any) {
      this.logger.error(`Failed to get auth session key hash: ${error}`)
      return null
    }
  }

  /**
   * 派生 API 签名密钥（HKDF�?
   *
   * 使用场景�?
   * - Sign Guard 验证 HMAC 签名时调�?
   * - 每次Request都会派生一次（性能开销小，HKDF 很快�?
   *
   * 派生公式�?
   * signKey = HKDF-SHA256(
   *   ikm = authSessionKeyHash,     // 输入密钥材料（session root�?
   *   salt = aesKey,                  // 盐值（设备/页面的握手密钥）
   *   info = 'walnut-admin-api-sign-v1', // 用途标�?
   *   length = 32                     // 输出长度
   * )
   *
   * 为什么使�?HKDF�?
   * 1. 从一个高熵密钥派生多个独立的子密�?
   * 2. 不同�?salt �?info 产生完全不同的密�?
   * 3. 即使一个子密钥泄露，也不会影响其他子密�?
   * 4. 符合 NIST 推荐的密钥派生标�?
   *
   * @param userId User ID
   * @param deviceId Device ID
   * @param sessionId 会话 ID
   * @param aesKey 客户端握手时协商�?AES 密钥（作�?salt�?
   * @returns 派生的签名密钥（32 字节 Buffer�?
   */
  async deriveApiSignKey(
    userId: string,
    deviceId: string,
    sessionId: string,
    aesKey: string,
  ) {
    try {
      // 1. 获取 Session Key Hash
      const authSessionKeyHash = await this.getAuthSessionKeyHash(userId, deviceId, sessionId)
      if (!authSessionKeyHash) {
        this.logger.warn(
          `Cannot derive sign key: session not found (user=${userId}, device=${deviceId}, session=${sessionId})`,
        )
        return null
      }

      // 1.1 �?Cache 获取 Crypto HKDF 配置
      const cryptoHKDFConfig = await this.appSettingCahceService.getCryptoHKDFInfo()

      // 2. 使用 HKDF 派生签名密钥
      const derivedKey = hkdfSync(
        'sha256',
        Buffer.from(authSessionKeyHash), // IKM: session root?2 字节?
        Buffer.from(aesKey, 'utf8'), // salt: 设备握手密钥
        Buffer.from(cryptoHKDFConfig.API_SIGN, 'utf8'), // info: 用途标?
        32, // length: 输出 32 字节
      )

      this.logger.debug(
        `API sign key derived: user=${userId}, device=${deviceId}, session=${sessionId}`,
      )

      return derivedKey
    }
    catch (error: any) {
      this.logger.error(`Failed to derive API sign key: ${error}`)
      return null
    }
  }

  /**
   * 验证 Session Key（可选功能）
   *
   * 使用场景�?
   * - 调试 / 高安全场�?
   * - 验证客户端持有的 session key 是否正确
   *
   * 注意：使�?timingSafeEqual 防止时序攻击
   *
   * @param userId User ID
   * @param deviceId Device ID
   * @param sessionId 会话 ID
   * @param candidateKey 待验证的 Session Key
   * @returns 是否匹配
   */
  async verifySessionKey(
    userId: string,
    deviceId: string,
    sessionId: string,
    candidateKey: Buffer,
  ): Promise<boolean> {
    try {
      const session = await this.cacheService.get<AuthSession>(
        this.getCacheKey(userId, deviceId, sessionId),
      )

      if (isNil(session)) {
        this.logger.warn(
          `Session not found for verification: user=${userId}, device=${deviceId}, session=${sessionId}`,
        )
        return false
      }

      const candidateHash = hash(candidateKey)

      // 使用 timingSafeEqual 防止时序攻击
      const isValid = timingSafeEqual(session.authSessionKeyHash, candidateHash)

      this.logger.debug(
        `Session key verification: user=${userId}, device=${deviceId}, session=${sessionId}, valid=${isValid}`,
      )

      return isValid
    }
    catch (error: any) {
      this.logger.error(`Failed to verify session key: ${error}`)
      return false
    }
  }

  /**
   * 主动吊销会话（踢下线 / 风控�?
   *
   * 使用场景�?
   * 1. 用户主动登出
   * 2. 管理员强制踢下线
   * 3. 风控检测到异常行为
   * 4. 密码修改后吊销所有会�?
   *
   * @param userId User ID
   * @param deviceId Device ID（可选，不传则吊销该用户所有设备的会话�?
   * @param sessionId 会话 ID（可选，不传则吊销该设备的所有会话）
   */
  async revokeSession(
    userId: string,
    deviceId?: string,
    sessionId?: string,
  ): Promise<void> {
    try {
      let pattern: string

      if (!isNil(sessionId) && !isNil(deviceId)) {
        // 吊销特定会话
        pattern = this.getCacheKey(userId, deviceId, sessionId)
        this.logger.log(
          `Revoking specific session: user=${userId}, device=${deviceId}, session=${sessionId}`,
        )
      }
      else if (!isNil(deviceId)) {
        // 吊销该设备的所有会�?
        pattern = this.getCacheKey(userId, deviceId, '*')
        this.logger.log(
          `Revoking all sessions for device: user=${userId}, device=${deviceId}`,
        )
      }
      else {
        // 吊销该用户的所有会话（所有设备）
        pattern = `${WalnutAdminConstAppCacheKeys.AUTH_SESSIONS}:${userId}:*`
        this.logger.log(
          `Revoking all sessions for user: user=${userId}`,
        )
      }

      await this.cacheService.delByPattern(pattern)

      this.logger.log(`Session(s) revoked successfully: pattern=${pattern}`)
    }
    catch (error: any) {
      this.logger.error(`Failed to revoke session: ${error}`)
      throw error
    }
  }
}

/* ============================================================
 * 工具函数
 * ============================================================ */

/**
 * 生成随机 Session ID�?2 位十六进制）
 */
function randomSessionId(): string {
  return randomBytes(16).toString('hex')
}

/**
 * 计算 SHA-256 哈希
 *
 * 为什么使�?SHA-256�?
 * 1. 单向函数，无法从 hash 恢复原始 key
 * 2. 固定长度输出�?2 字节），便于存储和比�?
 * 3. 广泛使用的标准哈希算�?
 */
function hash(input: Buffer): Buffer {
  return createHash('sha256').update(input).digest()
}

/**
 * �?string �?Buffer 规范化为 Buffer
 */
function normalizeToBuffer(input: Buffer | string): Buffer {
  if (Buffer.isBuffer(input)) {
    return input
  }

  // 假设 string �?base64 编码（OPAQUE 协议的标准输出）
  return Buffer.from(input, 'base64')
}
