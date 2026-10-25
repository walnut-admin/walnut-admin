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
   */
  async findByJti(jti: string, em?: EntityManager) {
    return this.getRepository(em).findOne({ where: { jti } })
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
