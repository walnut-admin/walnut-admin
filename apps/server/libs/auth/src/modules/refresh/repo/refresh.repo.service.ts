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
   *
   * revoke-and-insert（2026-10-27）后同 (user, device) 维度是多行（历轮 revoked 旧行 +
   * 恰一行未撤销现役行），无 order 的 findOne 取行不确定 —— 恒按 created_at 取最新一行，
   * 让「登录复签 revive」「撤销判据」等调用方稳定落在最近一轮。判「设备是否活会话」
   * 不要用本方法（会命中 revoked 旧行），用 findActiveByDeviceIdAndUserId。
   */
  async findByDeviceIdAndUserId(
    deviceId: string,
    userId: string,
    em?: EntityManager,
  ) {
    return this.getRepository(em).findOne({
      where: { deviceId, userId },
      order: { createdAt: 'DESC' },
    })
  }

  /**
   * @description find the active (non-revoked) refresh token by device id and user id
   *
   * revoke-and-insert 后「未撤销行恒恰一行」，但必须显式筛 `revoked=false` 才保证
   * 取到它（裸 findOne 在多行下取行不确定）—— duplicate sign-in 判据与 monitor 的
   * 撤销判据都走这里。
   *
   * F-26：登录链的 duplicate-signin 判定是 check-then-act，读腿必须能持锁 ——
   * `{ lock: true }` 在**活跃事务**里下悲观写锁（`SELECT ... FOR UPDATE`），把
   * 「判现役行 → 插/复活行」这组写串行化；并发首插（该维度还没有任何行）锁不到行，
   * 由部分唯一索引 uq_rt_active_device_user 兜底（23505 → 受控 40109）。非事务上下文
   * 无法提供并发保护，退化为普通读（与 findByJti 的 lock 口径一致）。
   */
  async findActiveByDeviceIdAndUserId(
    deviceId: string,
    userId: string,
    em?: EntityManager,
    options?: { lock?: boolean },
  ) {
    const lock = options?.lock && em?.queryRunner?.isTransactionActive
      ? { mode: 'pessimistic_write' as const }
      : undefined

    return this.getRepository(em).findOne({
      where: { deviceId, userId, revoked: false },
      order: { createdAt: 'DESC' },
      ...(lock ? { lock } : {}),
    })
  }

  /**
   * @description find refresh token by jti
   *
   * 轮换读腿（事务内）必须传 `{ lock: true }` 持悲观写锁：revoke-and-insert 轮换
   * （2026-10-27）是「读校验 + 旧行置撤销 + INSERT 新行」的复合写，锁把这组写串行化
   * —— 防两个并发轮换事务各插一行（双现役行破坏「未撤销行恒恰一行」不变量）。
   * 锁本身**不构成重放拦截**，它只保证等锁者醒来读到的是胜者提交后的旧行（已
   * `revoked=true`）→ 被调用方 getNewAccessToken 的撤销判定拦下；guard 入口的
   * getTokenByJti（非事务、不锁）同样按撤销行拒绝 —— 重放窗口由行级撤销根治，
   * 与上一轮的入口密文快照比对方案（P0-1，已被本方案取代）无关。非事务的解密
   * 校验读不锁。
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
    // 悲观锁只在活跃事务里有意义：生产轮换路径恒在 @WalnutTx 内；
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
   * @description update revoked status（P1-9 修复：全量撤销）
   *
   * revoke-and-insert（2026-10-27）后同 (user, device) 维度恒多行（历轮 rotate 旧行 +
   * 现役行），撤销必须一次撤干净 —— 原 findOne 只撤「查到的第一行」，force-quit 会把
   * 最新现役行留在场外继续换发（P1-9 钉现状用例已同步改为全量撤销形态）。revokeReason
   * 仅在显式传入时覆盖（不传则保留各行原 reason —— 如 rotate 旧行的撤销原因不被
   * signout 的无理由撤销抹掉）。
   */
  async updateRevokedAndReason(
    userId: string,
    deviceId: string,
    revoked: boolean,
    em?: EntityManager,
    revokeReason?: IWalnutAdminConstRevokeRTType,
  ) {
    const result = await this.getRepository(em).update(
      { userId, deviceId },
      {
        revoked,
        ...(revokeReason !== undefined ? { revokeReason } : {}),
      },
    )
    return (result.affected ?? 0) > 0
  }

  /**
   * @description update token data (expiredAt, encryptedToken, revoked, revokeReason)
   */
  async saveRefreshTokenDoc(
    document: AuthRefreshTokenEntity,
    data: {
      expiredAt?: Date
      encryptedToken?: string
      revoked?: boolean
      revokeReason?: IWalnutAdminConstRevokeRTType
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
    if (data.revokeReason !== undefined) {
      document.revokeReason = data.revokeReason
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
