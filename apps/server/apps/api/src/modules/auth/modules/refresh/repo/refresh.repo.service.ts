import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { DataSource, LessThan } from 'typeorm'

import { AuthRefreshTokenEntity } from '../entity/refresh-token.entity'

/**
 * B7b 迁移：Mongo model → PG 命名连接 DataSource（B2/B6/B7a 同款形态）。
 *
 * - 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（缺省连接级 manager）；
 * - :20 / :34 / :126 三处 `new Types.ObjectId(userId)` 全部摘除，uuid 直传
 *   （phase3-plan §4 B7 项 —— userId 列本就是 uuid，refresh 轮换事务随之全 PG 化）；
 * - findExpiredTokens 走 idx_rt_expired (expired_at) 索引，判据列与实体/purge job 一致；
 * - deviceId 是业务键（FK → sys_device.device_id，Q5 定案），引用与查询一律按业务键。
 */
@Injectable()
export class AuthRefreshRepositoryService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(AuthRefreshTokenEntity)
  }

  /**
   * @description find all refresh token for user
   */
  async findAllRTForUser(userId: string, em?: EntityManager) {
    return this.getRepository(em).find({ where: { userId } })
  }

  /**
   * @description find refresh token by device id and user id
   */
  async findByDeviceIdAndUserId(
    deviceId: string,
    userId: string,
    em?: EntityManager,
  ) {
    return this.getRepository(em).findOne({
      where: { deviceId, userId },
    })
  }

  /**
   * @description find refresh token by jti
   *
   * 轮换读腿（事务内）必须传 `{ lock: true }` 持悲观写锁：轮换是同 jti 原地
   * 「读-改-写」（encrypted_token/expired_at 覆盖、revoked 恒 false），锁把并发轮换
   * 写腿串行化（防丢更新/双写）。注意锁本身**不构成重放拦截** —— 等锁的事务醒来读到
   * 「未撤销、未过期、设备匹配」的新一轮行（Mongo 时代靠事务写冲突 abort 一方，PG 侧
   * 无等价物，旧注释「悲观锁保住重放拦截口」与实际不符）；P0-1（2026-10-26）修复后
   * 重放拦截由 `getNewAccessToken` 锁内「入口时刻 encrypted_token 快照 vs 库中当前值」
   * 比对承担。非事务的解密校验读不锁。
   *
   * 迁移回归修复（API 回归 D 段 auth-session spec 抓出）：jti 为空（refresh 端点无
   * RT_JTI cookie 时 guard 直取 cookie 值传入）→ Mongo 版 findOne({jti: undefined})
   * 查无行 → 受控 RefreshTokenExpired（40101）；PG/TypeORM 把 undefined 当绑定参数
   * 下发 → pg 驱动 "bind parameters must not contain undefined" 未受控 50000。按
   * 「查无此 jti」语义收 nil → null（两个调用方本就有 null 分支）。
   */
  async findByJti(jti: string, em?: EntityManager, options?: { lock?: boolean }) {
    if (jti === undefined || jti === null || jti === '') {
      return null
    }
    // 悲观锁只在活跃事务里有意义：生产轮换路径恒在 @WalnutDBTransaction 内；
    // 非事务上下文（连接级 manager）无法提供并发保护，退化为普通读
    const lock = options?.lock && em?.queryRunner?.isTransactionActive
      ? { mode: 'pessimistic_write' as const }
      : undefined
    return this.getRepository(em).findOne({ where: { jti }, ...(lock ? { lock } : {}) })
  }

  /**
   * @description find expired refresh tokens（expired_at < now，idx_rt_expired 通道）
   */
  async findExpiredTokens(now: Date) {
    return this.getRepository().find({
      where: { expiredAt: LessThan(now) },
    })
  }

  /**
   * @description update revoked status
   */
  async updateRevokedAndReason(
    userId: string,
    deviceId: string,
    revoked: boolean,
    em?: EntityManager,
    revokeReason?: IWalnutAdminConstRevokeRTType,
  ) {
    const target = await this.findByDeviceIdAndUserId(deviceId, userId, em)
    if (!target)
      return false

    target.revoked = revoked
    if (revokeReason) {
      target.revokeReason = revokeReason
    }
    await this.getRepository(em).save(target)
    return true
  }

  /**
   * @description update token data (expiredAt, encryptedToken, revoked)
   */
  async saveRefreshTokenDoc(
    document: AuthRefreshTokenEntity,
    data: {
      expiredAt?: Date
      encryptedToken?: string
      revoked?: boolean
    },
    em?: EntityManager,
  ) {
    if (data.expiredAt !== undefined) {
      document.expiredAt = data.expiredAt
    }
    if (data.encryptedToken !== undefined) {
      document.encryptedToken = data.encryptedToken
    }
    if (data.revoked !== undefined) {
      document.revoked = data.revoked
    }

    await this.getRepository(em).save(document)
    return document
  }

  /**
   * @description create new refresh token（PK 缺省由 DB 端 uuidv7() 生成，save 后回带 id）
   */
  async create(
    data: {
      jti: string
      deviceId: string
      encryptedToken: string
      userId: string
      expiredAt: Date
    },
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)
    return repository.save(repository.create(data))
  }
}
